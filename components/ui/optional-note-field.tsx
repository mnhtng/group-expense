"use client";
import {useId,useState} from "react";
export function OptionalNoteField({value,onChange,maxLength=1000,placeholder="Nhập ghi chú"}:{value:string;onChange:(note:string)=>void;maxLength?:number;placeholder?:string}){
  const id=useId(),[expanded,setExpanded]=useState(Boolean(value)),open=expanded;
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setExpanded(v=>!v)} className="min-h-11 text-sm font-medium">
      {open?"Ghi chú":"Thêm ghi chú"}
    </button>
    {open&&<><label htmlFor={id} className="sr-only">Ghi chú</label>
      <textarea id={id} name="note" rows={2} maxLength={maxLength} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)} className="w-full resize-y rounded-xl border bg-card p-3"/></>}
  </div>;
}
