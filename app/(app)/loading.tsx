export default function Loading(){
  return <main className="app-page space-y-6" aria-busy="true" aria-label="Đang tải">
    <div className="h-10 w-2/3 rounded-xl bg-secondary"/>
    <div className="app-list" aria-hidden="true">{[0,1,2].map(i=><div key={i} className="app-list-row"><div className="size-11 rounded-xl bg-secondary"/><div className="h-5 w-1/2 rounded bg-secondary"/></div>)}</div>
    <span role="status" className="sr-only">Đang tải…</span>
  </main>;
}
