import Link from "next/link";
import type {ReactNode} from "react";
import {HugeiconsIcon} from "@hugeicons/react";
import {Add01Icon,ArrowLeft01Icon,ArrowRight01Icon,Calendar03Icon,MoreHorizontalIcon,
  Notification01Icon,RepeatIcon,Settings01Icon,UserCircleIcon,UserGroupIcon,Wallet01Icon}
  from "@hugeicons/core-free-icons";
import {cn} from "@/lib/utils";

const icons={add:Add01Icon,back:ArrowLeft01Icon,next:ArrowRight01Icon,calendar:Calendar03Icon,
  more:MoreHorizontalIcon,bell:Notification01Icon,repeat:RepeatIcon,settings:Settings01Icon,
  person:UserCircleIcon,groups:UserGroupIcon,wallet:Wallet01Icon};
export function AppIcon({name,className}:{name:keyof typeof icons;className?:string}){
  return <HugeiconsIcon icon={icons[name]} size={24} strokeWidth={1.8}
    aria-hidden="true" className={cn("shrink-0",className)}/>;
}
export function ActionLink({href,children,secondary=false}:{href:string;children:ReactNode;secondary?:boolean}){
  return <Link href={href} className={cn("app-action",secondary&&"app-action-secondary")}>{children}</Link>;
}
export function PageHeader({title,backHref,backLabel="Quay lại",context,action}:{
  title:string;backHref?:string;backLabel?:string;context?:string;action?:ReactNode;
}){
  return <header className="app-header">
    {backHref&&<Link href={backHref} className="app-back"><AppIcon name="back"/>{backLabel}</Link>}
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">{context&&<p className="app-caption mb-1 truncate">{context}</p>}
        <h1 className="app-title">{title}</h1></div>
      {action&&<div className="shrink-0">{action}</div>}
    </div>
  </header>;
}
export function GroupedList({children,label}:{children:ReactNode;label?:string}){
  return <div className="app-list" role={label?"region":undefined} aria-label={label}>{children}</div>;
}
export function NavigationRow({href,title,value,icon,danger=false}:{
  href:string;title:string;value?:string;icon?:keyof typeof icons;danger?:boolean;
}){
  return <Link href={href} className={cn("app-list-row",danger&&"text-destructive")}>
    {icon&&<span className="app-row-icon"><AppIcon name={icon}/></span>}
    <span className="min-w-0 flex-1 font-medium">{title}</span>
    {value&&<span className="app-caption shrink-0">{value}</span>}
    <AppIcon name="next" className="size-5 text-muted-foreground"/>
  </Link>;
}
export function SegmentedNav({label,items}:{label:string;items:{href:string;label:string;active:boolean}[]}){
  return <nav aria-label={label} className="app-segments">
    {items.map(item=><Link key={item.href} href={item.href} scroll={false}
      aria-current={item.active?"page":undefined} className={cn("app-segment",item.active&&"app-segment-active")}>
      {item.label}
    </Link>)}
  </nav>;
}
export function EmptyState({children,action}:{children:ReactNode;action?:ReactNode}){
  return <div className="app-empty"><p>{children}</p>{action}</div>;
}
