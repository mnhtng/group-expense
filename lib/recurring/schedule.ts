/** Pure ISO date-only helpers; no local-machine timezone dependence. */
const isoPattern=/^(\d{4})-(\d{2})-(\d{2})$/;
function parse(iso:string):{year:number;month:number;day:number} {
  const m=isoPattern.exec(iso);
  if(!m)throw Error("Ngày ISO không hợp lệ.");
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<2000||year>9999||date.getUTCFullYear()!==year||
    date.getUTCMonth()!==month-1||date.getUTCDate()!==day)
    throw Error("Ngày ISO không hợp lệ.");
  return {year,month,day};
}
const iso=(y:number,m:number,d:number) =>
  `${y.toString().padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const monthIndex=(d:{year:number;month:number}) => d.year*12+d.month-1;
const fromMonthIndex=(index:number) => ({
  year:Math.floor(index/12),month:index%12+1,
});

/** Day 29/30/31 rolls back to the last valid day of a shorter month. */
export function dueDateOfMonth(year:number,month:number,day:number):string {
  if(!Number.isInteger(day)||day<1||day>31||!Number.isInteger(year)||
     !Number.isInteger(month)||month<1||month>12)
    throw Error("Ngày lặp lại phải từ 1 đến 31.");
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return iso(year,month,Math.min(day,last));
}
export function dueDatesThrough(startsOn:string,today:string,dayOfMonth:number,
  maxMonths=24):{period:string;date:string}[] {
  const start=parse(startsOn),now=parse(today);
  const startIndex=monthIndex(start),nowIndex=monthIndex(now);
  if(nowIndex<startIndex)return [];
  const result:{period:string;date:string}[]=[];
  // Bound work per template, and always evaluate oldest outstanding months first.
  for(let i=startIndex;i<=nowIndex&&result.length<maxMonths;i++){
    const {year,month}=fromMonthIndex(i);
    const date=dueDateOfMonth(year,month,dayOfMonth);
    if(date>=startsOn&&date<=today)result.push({period:iso(year,month,1),date});
  }
  return result;
}
export function nextDueDate(startsOn:string,dayOfMonth:number,asOf:string):string {
  const start=parse(startsOn),now=parse(asOf);
  let index=Math.max(monthIndex(start),monthIndex(now));
  for(let i=0;i<3;i++,index++){
    const {year,month}=fromMonthIndex(index);
    const date=dueDateOfMonth(year,month,dayOfMonth);
    if(date>=startsOn&&date>=asOf)return date;
  }
  throw Error("Không tính được kỳ định kỳ tiếp theo.");
}
