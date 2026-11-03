"use client";

import { useEffect, useRef, useState } from "react";

export function InviteQr({url,groupName}:{url:string;groupName:string}) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const [png,setPng]=useState<File|null>(null);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  useEffect(()=>{
    let active=true;
    const canvas=canvasRef.current;
    if(!canvas||!url)return;
    void import("qrcode-generator").then(({default:qrcode})=>{
      if(!active)return;
      const qr=qrcode(0,"M");
      qr.addData(url,"Byte");
      qr.make();
      const count=qr.getModuleCount();
      const cell=Math.max(4,Math.floor(640/(count+8)));
      const size=(count+8)*cell;
      canvas.width=size;canvas.height=size;
      const context=canvas.getContext("2d");
      if(!context)throw new Error("Canvas unavailable");
      context.fillStyle="#ffffff";
      context.fillRect(0,0,size,size);
      context.fillStyle="#111111";
      for(let row=0;row<count;row++){
        for(let col=0;col<count;col++){
          if(qr.isDark(row,col))context.fillRect((col+4)*cell,(row+4)*cell,cell,cell);
        }
      }
      canvas.toBlob(blob=>{
        if(!active)return;
        if(!blob){setError("Không tạo được ảnh QR.");return;}
        setPng(new File([blob],"loi-moi-nhom.png",{type:"image/png"}));
        setError("");
      },"image/png");
    }).catch(()=>{
      if(active)setError("Không tạo được QR. Bạn vẫn có thể gửi link.");
    });
    return()=>{active=false;};
  },[url]);

  function download(){
    if(!png)return;
    const objectUrl=URL.createObjectURL(png);
    const link=document.createElement("a");
    link.href=objectUrl;link.download=png.name;
    document.body.append(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
  }

  async function share(){
    if(!png)return;
    setError("");setNotice("");
    // No await before navigator.share: iOS requires a live user gesture.
    if(typeof navigator.share!=="function"){
      download();
      setNotice("Đã tải ảnh QR để gửi.");
      return;
    }
    const fileSupported=typeof navigator.canShare==="function"&&
      navigator.canShare({files:[png]});
    try {
      await navigator.share(fileSupported
        ? {files:[png],title:`Mời vào nhóm ${groupName}`,text:"Quét QR để tham gia nhóm."}
        : {title:`Mời vào nhóm ${groupName}`,url});
      if(!fileSupported)setNotice("Máy chỉ chia sẻ link. Chọn Tải QR để gửi ảnh.");
    }catch(cause){
      if(cause instanceof Error&&cause.name==="AbortError")return;
      setError("Không chia sẻ được. Hãy tải QR hoặc sao chép link.");
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm font-semibold">Quét QR để tham gia</p>
      <canvas ref={canvasRef} role="img" aria-label={`Mã QR mời vào nhóm ${groupName}`}
        className="aspect-square w-full max-w-[240px] rounded-xl border bg-white p-2"
        style={{imageRendering:"pixelated"}}/>
      {!png&&!error&&<p role="status" className="text-xs text-muted-foreground">Đang tạo QR...</p>}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={!png} onClick={()=>void share()}
        className="min-h-12 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        Chia sẻ QR
      </button>
      <button type="button" disabled={!png} onClick={download}
        className="min-h-12 rounded-xl border px-3 py-3 text-sm font-medium disabled:opacity-50">
        Tải QR
      </button>
    </div>
    {notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
