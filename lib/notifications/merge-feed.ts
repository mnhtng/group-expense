/**
 * Keep older notification pages when the first page is refreshed in
 * the background. No disappearing cards or scroll jumps due to pagination.
 */
export function mergeNotificationFeed<T extends {id:string}>(
  previous:readonly T[],incoming:readonly T[],appendOlder=false,
):T[]{
  const result:T[]=[];
  const visited=new Set<string>();
  const ordered=appendOlder?[...previous,...incoming]:[...incoming,...previous];
  for(const item of ordered){
    if(visited.has(item.id))continue;
    visited.add(item.id);
    result.push(item);
  }
  return result;
}
