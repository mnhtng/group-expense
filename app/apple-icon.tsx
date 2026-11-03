import { ImageResponse } from "next/og";
export const size={width:180,height:180};
export const contentType="image/png";
export default function AppleIcon(){
  return new ImageResponse(
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
      justifyContent:"center",borderRadius:40,background:"#315e50"}}>
      <div style={{display:"flex",flexDirection:"column",justifyContent:"space-around",
        background:"#ffffff",borderRadius:20,width:116,height:91,padding:"18px 20px"}}>
        <div style={{display:"flex",width:76,height:9,borderRadius:6,background:"#315e50"}}/>
        <div style={{display:"flex",width:48,height:9,borderRadius:6,background:"#315e50"}}/>
      </div>
    </div>,{...size}
  );
}
