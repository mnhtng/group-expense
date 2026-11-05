import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { todayVietnamISO } from "@/lib/date-format";
import {
  prepareExpense, ExpenseValidationError, type ExpenseInput, type ItemInput,
  type PreparedExpense,
} from "@/lib/expenses/domain";
import { createExpenseInTransaction } from "@/lib/expenses/service";
import { dueDatesThrough, nextDueDate } from "@/lib/recurring/schedule";

export type RecurringItem = Omit<ItemInput,"shares"> & {shares:NonNullable<ItemInput["shares"]>};

export type RecurringDraft = {
  title: string; notes?: string; payerId: string;
  dayOfMonth: number; startsOn: string; items: ItemInput[];
};
export type RecurringRule = {
  id:string;groupId:string;title:string;notes:string;
  payerId:string;payerName:string;createdBy:string;creatorName:string;
  dayOfMonth:number;startsOn:string;items:RecurringItem[];
  totalMinor:string;status:"active"|"paused";pauseReason:string|null;
  version:number;createdAt:string;lastPeriod:string|null;
};
export type RecurringOccurrence = {
  id:string; period:string; scheduledOn:string; expenseId:string;
  title:string; completedAt:string|null;
};
export class RecurringError extends Error {
  constructor(public readonly status:400|403|404|409,message:string) {
    super(message);this.name="RecurringError";
  }
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalized(draft:RecurringDraft,members:string[]):{
  template:Omit<RecurringDraft,"items"> & {items:RecurringItem[]};prepared:PreparedExpense;
} {
  if(!draft||typeof draft!=="object")throw new ExpenseValidationError("Dữ liệu định kỳ không hợp lệ.");
  if(!Number.isInteger(draft.dayOfMonth)||draft.dayOfMonth<1||draft.dayOfMonth>31)
    throw new ExpenseValidationError("Ngày lặp hằng tháng phải từ 1 đến 31.");
  const date=draft.startsOn;
  const today=todayVietnamISO();
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new ExpenseValidationError("Ngày bắt đầu không hợp lệ.");
  // Validate ISO calendar dates using the standard invoice validator.
  const prepared=prepareExpense({
    title:draft.title,notes:draft.notes,occurredOn:date,
    payerId:draft.payerId,items:draft.items,
  },members);
  if(date<today)throw new ExpenseValidationError(
    "Ngày bắt đầu phải từ hôm nay trở đi để tránh tự phát sinh hóa đơn của các tháng trước."
  );
  // Freeze the exact per-person amounts. Changes to the roster don't
  // silently change a bill's original monetary split.
  const items:RecurringItem[]=prepared.items.map(item=>({
    name:item.name,quantity:item.quantity,unitPriceMinor:item.unitPriceMinor,
    participants:item.shares.map(share=>share.userId),
    shares:item.shares.map(({userId,amountMinor})=>({userId,amountMinor})),
  }));
  return {
    prepared,
    template:{
      title:prepared.title,notes:prepared.notes,
      payerId:prepared.payerId,dayOfMonth:draft.dayOfMonth,
      startsOn:prepared.occurredOn,items,
    },
  };
}
async function lockedGroup(client:PoolClient,groupId:string,actorId?:string) {
  const g=await client.query(
    "SELECT id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",[groupId]);
  if(!g.rowCount)throw new RecurringError(404,"Không tìm thấy nhóm.");
  const r=await client.query<{user_id:string}>(
    "SELECT user_id FROM group_members WHERE group_id=$1 AND status='active'",[groupId]);
  const members=r.rows.map(x=>x.user_id);
  if(actorId&&!members.includes(actorId))
    throw new RecurringError(404,"Bạn không thuộc nhóm.");
  return members;
}
async function tx<T>(fn:(client:PoolClient)=>Promise<T>) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const result=await fn(client);
    await client.query("COMMIT");
    return result;
  } catch(error) {
    await client.query("ROLLBACK");throw error;
  } finally {client.release();}
}
const ruleColumns=`
  r.id,r.group_id AS "groupId",r.created_by AS "createdBy",
  r.payer_id AS "payerId",payer.name AS "payerName",
  creator.name AS "creatorName",r.title,r.notes,
  r.day_of_month AS "dayOfMonth",r.starts_on::text AS "startsOn",
  r.items,r.total_minor::text AS "totalMinor",
  r.status,r.pause_reason AS "pauseReason",r.version,
  r.created_at::text AS "createdAt",
  (SELECT max(o.period)::text FROM recurring_expense_occurrences o
    WHERE o.rule_id=r.id) AS "lastPeriod"`;
const joins=`
  JOIN "user" payer ON payer.id=r.payer_id
  JOIN "user" creator ON creator.id=r.created_by`;

export async function listRecurringRules(groupId:string,actorId:string) {
  const result=await pool.query<RecurringRule>(
    `SELECT ${ruleColumns} FROM recurring_expense_rules r ${joins}
      WHERE r.group_id=$1 AND EXISTS(
        SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
        WHERE gm.group_id=r.group_id AND gm.user_id=$2 AND gm.status='active'
          AND g.archived_at IS NULL)
      ORDER BY CASE WHEN r.status='active' THEN 0 ELSE 1 END,r.created_at DESC`,
    [groupId,actorId],
  );
  return result.rows;
}
export async function getRecurringRule(groupId:string,id:string,actorId:string) {
  if(!uuid.test(id))return null;
  const rows=await listRecurringRules(groupId,actorId);
  return rows.find(x=>x.id===id)??null;
}
export async function listRecurringOccurrences(groupId:string,ruleId:string,actorId:string) {
  const access=await pool.query(
    `SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
     WHERE gm.group_id=$1 AND gm.user_id=$2 AND gm.status='active'
       AND g.archived_at IS NULL`,[groupId,actorId]);
  if(!access.rowCount)throw new RecurringError(404,"Không tìm thấy nhóm.");
  const r=await pool.query<RecurringOccurrence>(
    `SELECT o.id,o.period::text AS period,o.scheduled_on::text AS "scheduledOn",
      o.expense_id AS "expenseId",e.title,e.completed_at::text AS "completedAt"
     FROM recurring_expense_occurrences o JOIN expenses e ON e.id=o.expense_id
     WHERE o.group_id=$1 AND o.rule_id=$2
     ORDER BY o.period DESC LIMIT 36`,[groupId,ruleId]);
  return r.rows;
}
export async function createRecurringRule(groupId:string,actorId:string,raw:RecurringDraft) {
  return tx(async client=>{
    const members=await lockedGroup(client,groupId,actorId);
    const {template,prepared}=normalized(raw,members);
    const id=randomUUID();
    await client.query(
      `INSERT INTO recurring_expense_rules
       (id,group_id,created_by,payer_id,title,notes,day_of_month,starts_on,
        items,total_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [id,groupId,actorId,template.payerId,template.title,template.notes,
        template.dayOfMonth,template.startsOn,JSON.stringify(template.items),
        prepared.totalMinor],
    );
    return {id,version:1};
  });
}
export async function updateRecurringRule(groupId:string,id:string,actorId:string,
  expectedVersion:number,raw:RecurringDraft) {
  if(!uuid.test(id))throw new RecurringError(404,"Không tìm thấy chi phí định kỳ.");
  return tx(async client=>{
    const members=await lockedGroup(client,groupId,actorId);
    const row=await client.query<{created_by:string;version:number;starts_on:string}>(
      `SELECT created_by,version,starts_on::text FROM recurring_expense_rules
       WHERE id=$1 AND group_id=$2 FOR UPDATE`,[id,groupId]);
    const old=row.rows[0];
    if(!old)throw new RecurringError(404,"Không tìm thấy chi phí định kỳ.");
    if(old.created_by!==actorId)throw new RecurringError(403,
      "Chỉ người tạo chi phí định kỳ có quyền sửa.");
    if(!Number.isSafeInteger(expectedVersion)||old.version!==expectedVersion)
      throw new RecurringError(409,"Mẫu đã được cập nhật; hãy tải lại.");
    // Editing a historical start date must not manufacture backdated invoices.
    const effective={...raw,startsOn:raw.startsOn===old.starts_on
      ? todayVietnamISO() : raw.startsOn};
    const {template,prepared}=normalized(effective,members);
    // Preserve the original activation date on unchanged edits.
    const startsOn=raw.startsOn===old.starts_on ? old.starts_on:template.startsOn;
    await client.query(
      `UPDATE recurring_expense_rules
       SET payer_id=$3,title=$4,notes=$5,day_of_month=$6,starts_on=$7,
         items=$8::jsonb,total_minor=$9,version=version+1,
         pause_reason=NULL,updated_at=now()
       WHERE id=$1 AND group_id=$2`,
      [id,groupId,template.payerId,template.title,template.notes,
        template.dayOfMonth,startsOn,JSON.stringify(template.items),
        prepared.totalMinor],
    );
    return {id,version:expectedVersion+1};
  });
}
export async function setRecurringStatus(groupId:string,id:string,actorId:string,
  expectedVersion:number,status:"active"|"paused") {
  if(!uuid.test(id))throw new RecurringError(404,"Không tìm thấy chi phí định kỳ.");
  if(status!=="active"&&status!=="paused")throw new RecurringError(400,"Trạng thái không hợp lệ.");
  return tx(async client=>{
    await lockedGroup(client,groupId,actorId);
    const row=await client.query<{created_by:string;version:number;status:string}>(
      `SELECT created_by,version,status FROM recurring_expense_rules
       WHERE id=$1 AND group_id=$2 FOR UPDATE`,[id,groupId]);
    const rule=row.rows[0];
    if(!rule)throw new RecurringError(404,"Không tìm thấy chi phí định kỳ.");
    if(rule.created_by!==actorId)throw new RecurringError(403,
      "Chỉ người tạo chi phí định kỳ có quyền tạm dừng hoặc tiếp tục.");
    if(rule.version!==expectedVersion)throw new RecurringError(409,"Mẫu đã thay đổi; tải lại.");
    if(rule.status===status)throw new RecurringError(409,"Trạng thái này đã được áp dụng.");
    const start=status==="active"?todayVietnamISO():null;
    await client.query(
      `UPDATE recurring_expense_rules SET status=$3,
       starts_on=CASE WHEN $4::date IS NOT NULL THEN $4::date ELSE starts_on END,
       pause_reason=NULL,version=version+1,updated_at=now()
       WHERE id=$1 AND group_id=$2`,[id,groupId,status,start]);
    return {id,version:expectedVersion+1,status};
  });
}

/** Generate due invoices with DB group locks and UNIQUE(rule_id,period).
 * Re-running after a timeout is safe. Each month is a normal expense that
 * stays editable only by the original template creator.
 */
export async function generateDueRecurringExpenses(
  today=todayVietnamISO(),maxGenerated=20,onlyRuleId?:string,
):Promise<{generated:number;ignored:number;paused:number;errors:number;
  checked:number;hasMoreRules:boolean}> {
  // Validate date before any database activity.
  dueDatesThrough(today,today,1);
  const rows=await pool.query<{id:string;group_id:string}>(
    `SELECT r.id,r.group_id FROM recurring_expense_rules r
     JOIN groups g ON g.id=r.group_id
     LEFT JOIN recurring_cron_checkpoints cp ON cp.rule_id=r.id
     WHERE r.status='active' AND g.archived_at IS NULL
       AND ($1::uuid IS NULL OR r.id=$1)
     ORDER BY cp.last_checked_at ASC NULLS FIRST,r.id LIMIT 201`,
    [onlyRuleId??null],
  );
  const result={generated:0,ignored:0,paused:0,errors:0,
    checked:0,hasMoreRules:false};
  // LIMIT 201 reveals whether the bounded 200-rule scan is incomplete.
  // PostgreSQL checkpoints rotate the oldest last-checked rules to
  // prevent starving newly activated recurring rules.
  for(const target of rows.rows.slice(0,200)) {
    if(result.generated>=maxGenerated)break;
    let failed=false;
    try {
      const current=await tx(async client=>{
        const members=await lockedGroup(client,target.group_id);
        const row=await client.query<{
          id:string;group_id:string;created_by:string;payer_id:string;
          title:string;notes:string;day_of_month:number;starts_on:string;
          items:RecurringItem[];status:string;
        }>(
          `SELECT id,group_id,created_by,payer_id,title,notes,day_of_month,
           starts_on::text,items,status
           FROM recurring_expense_rules WHERE id=$1 AND group_id=$2 FOR UPDATE`,
          [target.id,target.group_id],
        );
        const rule=row.rows[0];
        if(!rule||rule.status!=="active")return {generated:0,ignored:1,paused:0};
        const dates=dueDatesThrough(rule.starts_on,today,rule.day_of_month,120);
        const pending=await client.query<{period:string}>(
          `SELECT period::text FROM recurring_expense_occurrences WHERE rule_id=$1`,
          [rule.id],
        );
        const existing=new Set(pending.rows.map(x=>x.period));
        const due=dates.filter(x=>!existing.has(x.period)).slice(0,maxGenerated-result.generated);
        if(due.length===0)return {generated:0,ignored:1,paused:0};

        const template:ExpenseInput={
          title:rule.title,notes:rule.notes,occurredOn:today,
          payerId:rule.payer_id,items:rule.items,
        };
        let prepared:PreparedExpense;
        try {prepared=prepareExpense(template,members);}
        catch(error) {
          // Members can leave: never create obligations for former members.
          if(error instanceof ExpenseValidationError){
            await client.query(
              `UPDATE recurring_expense_rules SET status='paused',
               pause_reason=$2,version=version+1,updated_at=now() WHERE id=$1`,
              [rule.id,"Thành viên hoặc người trả tiền đã thay đổi; hãy sửa mẫu rồi tiếp tục."],
            );
            return {generated:0,ignored:0,paused:1};
          }
          throw error;
        }
        if(!members.includes(rule.created_by)) {
          await client.query(
            `UPDATE recurring_expense_rules SET status='paused',
               pause_reason=$2,version=version+1,updated_at=now() WHERE id=$1`,
            [rule.id,"Người tạo không còn là thành viên hoạt động."],
          );
          return {generated:0,ignored:0,paused:1};
        }
        let made=0;
        for(const occurrence of due) {
          const bill={...prepared,occurredOn:occurrence.date};
          const invoice=await createExpenseInTransaction(
            client,rule.group_id,rule.created_by,bill,
            {recurringRuleId:rule.id,period:occurrence.period},
          );
          await client.query(
            `INSERT INTO recurring_expense_occurrences
             (id,rule_id,group_id,period,scheduled_on,expense_id)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [randomUUID(),rule.id,rule.group_id,occurrence.period,
              occurrence.date,invoice.id],
          );
          made++;
        }
        return {generated:made,ignored:0,paused:0};
      });
      result.generated+=current.generated;
      result.ignored+=current.ignored;
      result.paused+=current.paused;
    }catch(error) {
      failed=true;
      result.errors++;
      console.error("Recurring generation failed",error instanceof Error?error.name:"Unknown");
    }
    if(!onlyRuleId){
      await pool.query(`INSERT INTO recurring_cron_checkpoints
        (rule_id,last_checked_at,last_error_at)
        VALUES($1,clock_timestamp(),
          CASE WHEN $2 THEN clock_timestamp() ELSE NULL END)
        ON CONFLICT(rule_id) DO UPDATE SET
          last_checked_at=EXCLUDED.last_checked_at,
          last_error_at=EXCLUDED.last_error_at`,
        [target.id,failed]);
    }
    result.checked++;
  }
  result.hasMoreRules=rows.rows.length>result.checked;
  return result;
}
export function recurringNextDate(rule:Pick<RecurringRule,"startsOn"|"dayOfMonth"|"lastPeriod">) {
  const now=todayVietnamISO();
  let asOf=now;
  // If the current month's occurrence already exists, show the next month.
  if(rule.lastPeriod&&rule.lastPeriod===now.slice(0,7)+"-01"){
    const next=new Date(now+"T00:00:00Z");
    next.setUTCMonth(next.getUTCMonth()+1,1);
    asOf=next.toISOString().slice(0,10);
  }
  return nextDueDate(rule.startsOn,rule.dayOfMonth,asOf);
}
