/**
 * SC-002 pure calendar math. No database, financial side effects or timezone
 * dependence on the Vercel machine's locale.
 *
 * Every automatic period is [start,end) in a group's IANA timezone.
 * The anchor is the FIRST day of a full period, never a partial period.
 */
export type CycleFrequency = "weekly" | "biweekly" | "monthly" | "manual";
export const CYCLE_FREQUENCIES: readonly CycleFrequency[] =
  ["weekly","biweekly","monthly","manual"];
type Parts = {year:number;month:number;day:number};
export type LocalPeriod = {start:string;end:string};
const MS_PER_DAY=86_400_000;
const zoneFormatters=new Map<string,Intl.DateTimeFormat>();

function dateParts(source:string):Parts {
  if(typeof source!=="string")throw Error("Ngày phải theo định dạng YYYY-MM-DD.");
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if(!match)throw Error("Ngày phải theo định dạng YYYY-MM-DD.");
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(year<2000||year>9998||month<1||month>12||day<1||
     day>new Date(Date.UTC(year,month,0)).getUTCDate())
    throw Error("Ngày lịch không hợp lệ.");
  return {year,month,day};
}
export function validLocalDate(source:string):string {
  dateParts(source);
  return source;
}
function iso(p:Parts):string {
  return `${p.year.toString().padStart(4,"0")}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}
function utcDay(source:string):number {
  const d=dateParts(source);
  return Math.floor(Date.UTC(d.year,d.month-1,d.day)/MS_PER_DAY);
}
function fromUtcDay(day:number):string {
  const d=new Date(day*MS_PER_DAY);
  return validLocalDate(iso({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()}));
}
export function addCalendarDays(date:string,n:number):string {
  if(!Number.isSafeInteger(n))throw Error("Số ngày không hợp lệ.");
  return fromUtcDay(utcDay(date)+n);
}
const monthIndex=(p:Parts)=>p.year*12+p.month-1;
function monthlyBoundary(anchor:Parts,index:number) {
  const m=monthIndex(anchor)+index;
  const year=Math.floor(m/12),month=m%12+1;
  const max=new Date(Date.UTC(year,month,0)).getUTCDate();
  return iso({year,month,day:Math.min(anchor.day,max)});
}
/** Returns null before the anchor and for manually controlled cycles. */
export function periodContaining(
  localDate:string,frequency:CycleFrequency,anchorDate:string,
):LocalPeriod|null {
  const now=dateParts(localDate),anchor=dateParts(anchorDate);
  if(!CYCLE_FREQUENCIES.includes(frequency))
    throw Error("Chu kỳ không hợp lệ.");
  if(frequency==="manual"||localDate<anchorDate)return null;
  if(frequency==="monthly") {
    let i=monthIndex(now)-monthIndex(anchor);
    if(monthlyBoundary(anchor,i)>localDate)i--;
    if(i<0)return null;
    return {start:monthlyBoundary(anchor,i),end:monthlyBoundary(anchor,i+1)};
  }
  const step=frequency==="weekly"?7:14;
  const period=Math.floor((utcDay(localDate)-utcDay(anchorDate))/step);
  return {
    start:addCalendarDays(anchorDate,period*step),
    end:addCalendarDays(anchorDate,(period+1)*step),
  };
}
export function isPeriodBoundary(
  localDate:string,frequency:CycleFrequency,anchorDate:string,
):boolean {
  validLocalDate(localDate);validLocalDate(anchorDate);
  if(!CYCLE_FREQUENCIES.includes(frequency))throw Error("Chu kỳ không hợp lệ.");
  if(localDate<anchorDate)return false;
  if(frequency==="manual")return true;
  return periodContaining(localDate,frequency,anchorDate)?.start===localDate;
}
function formatter(timeZone:string):Intl.DateTimeFormat {
  if(typeof timeZone!=="string"||timeZone.length>64||!timeZone.length)
    throw Error("Múi giờ IANA không hợp lệ.");
  let f=zoneFormatters.get(timeZone);
  if(!f) {
    try {
      f=new Intl.DateTimeFormat("en-GB",{
        timeZone,year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",
      });
    } catch {throw Error("Múi giờ IANA không hợp lệ.");}
    zoneFormatters.set(timeZone,f);
  }
  return f;
}
function zonedParts(epochMs:number,timeZone:string) {
  const values=new Map(formatter(timeZone).formatToParts(new Date(epochMs))
    .map(p=>[p.type,Number(p.value)]));
  return {
    year:values.get("year")!,month:values.get("month")!,day:values.get("day")!,
    hour:values.get("hour")!,minute:values.get("minute")!,second:values.get("second")!,
  };
}
export function currentLocalDate(timeZone:string,nowMs=Date.now()):string {
  const p=zonedParts(nowMs,timeZone);
  return iso(p);
}
/**
 * Resolve exactly one UTC instant that is 00:00:00 at the stated local date.
 * DST gaps (no midnight) and ambiguous repeated midnights fail CLOSED.
 * Never silently shift to 01:00 or to the previous date.
 */
export function localMidnightInstant(localDate:string,timeZone:string):string {
  const d=dateParts(localDate);
  formatter(timeZone);
  const target=Date.UTC(d.year,d.month-1,d.day);
  const offsets=new Set<number>();
  for(let hour=-36;hour<=36;hour+=3) {
    const sample=target+hour*3_600_000;
    const p=zonedParts(sample,timeZone);
    const localMs=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    offsets.add(localMs-sample);
  }
  const matches=new Set<number>();
  for(const offset of offsets) {
    const at=target-offset;
    const p=zonedParts(at,timeZone);
    if(p.year===d.year&&p.month===d.month&&p.day===d.day&&
       p.hour===0&&p.minute===0&&p.second===0)matches.add(at);
  }
  if(matches.size!==1)
    throw Error("Nửa đêm địa phương không tồn tại hoặc bị lặp do chuyển múi giờ.");
  return new Date([...matches][0]).toISOString();
}
