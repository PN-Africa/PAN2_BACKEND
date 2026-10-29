// Orthogonal routing through whitespace. The same routes can be rendered as
// native PPTX segments or open SVG paths; text rectangles are hard obstacles.
const eps=1e-7,round=n=>Math.round(n*1e6)/1e6;
export const segmentOverlap=(a,b)=>{
 const horizontal=Math.abs(a.y1-a.y2)<eps&&Math.abs(b.y1-b.y2)<eps;
 const vertical=Math.abs(a.x1-a.x2)<eps&&Math.abs(b.x1-b.x2)<eps;
 if(horizontal&&Math.abs(a.y1-b.y1)<eps)return Math.max(0,Math.min(Math.max(a.x1,a.x2),Math.max(b.x1,b.x2))-Math.max(Math.min(a.x1,a.x2),Math.min(b.x1,b.x2)));
 if(vertical&&Math.abs(a.x1-b.x1)<eps)return Math.max(0,Math.min(Math.max(a.y1,a.y2),Math.max(b.y1,b.y2))-Math.max(Math.min(a.y1,a.y2),Math.min(b.y1,b.y2)));
 return 0;
};
export function segmentHitsRect(s,r){
 if(Math.abs(s.y1-s.y2)<eps)return s.y1>r.y+eps&&s.y1<r.y+r.h-eps&&Math.max(s.x1,s.x2)>r.x+eps&&Math.min(s.x1,s.x2)<r.x+r.w-eps;
 return s.x1>r.x+eps&&s.x1<r.x+r.w-eps&&Math.max(s.y1,s.y2)>r.y+eps&&Math.min(s.y1,s.y2)<r.y+r.h-eps;
}
export function routeDiagramConnectors(nodes,edges,bounds,{obstacles=[],clearance=.045}={}){
 const rects=[...nodes,...obstacles],byId=new Map(nodes.map(n=>[n.id,n])),routes=[],used=[];
 const inside=p=>p.x>=bounds.x-eps&&p.y>=bounds.y-eps&&p.x<=bounds.x+bounds.w+eps&&p.y<=bounds.y+bounds.h+eps;
 const ports=(n,side)=>({right:[{x:n.x+n.w+clearance,y:n.y+n.h/2}],left:[{x:n.x-clearance,y:n.y+n.h/2}],top:[{x:n.x+n.w/2,y:n.y-clearance}],bottom:[{x:n.x+n.w/2,y:n.y+n.h+clearance}]}[side]).filter(inside);
 const unique=values=>[...new Set(values.map(round))].sort((a,b)=>a-b);
 const xs=unique([bounds.x,bounds.x+bounds.w,...rects.flatMap(r=>[r.x-clearance,r.x+r.w+clearance,r.x+r.w/2])].filter(x=>x>=bounds.x&&x<=bounds.x+bounds.w));
 const ys=unique([bounds.y,bounds.y+bounds.h,...rects.flatMap(r=>[r.y-clearance,r.y+r.h+clearance,r.y+r.h/2])].filter(y=>y>=bounds.y&&y<=bounds.y+bounds.h));
 // Extra lanes let independent connections avoid becoming a shared visual bus.
 const lanes=axis=>unique(axis.flatMap((v,i)=>i?[(axis[i-1]+v)/2,v]:[v]));
 const X=lanes(xs),Y=lanes(ys),W=X.length,index=p=>Y.indexOf(round(p.y))*W+X.indexOf(round(p.x)),point=i=>({x:X[i%W],y:Y[Math.floor(i/W)]});
 for(const [edgeIndex,edge] of edges.entries()){
  const source=byId.get(edge.from),target=byId.get(edge.to),sameRow=Math.abs(source.y-target.y)<clearance;
  // Preserve a readable flow: across a row, or down/up between rows. Choosing
  // any shortest side independently can create a pointless U below two peers.
  const fromSide=sameRow?(source.x<target.x?'right':'left'):(source.y<target.y?'bottom':'top'),toSide=sameRow?(source.x<target.x?'left':'right'):(source.y<target.y?'top':'bottom');
  const from=ports(source,fromSide),to=ports(target,toSide),targets=new Set(to.map(index)),distance=new Map(),previous=new Map(),queue=[];
  for(const p of from){const id=index(p),key=id*3;distance.set(key,0);queue.push({key,id,dir:0,cost:0});}
  let end;
  while(queue.length){queue.sort((a,b)=>b.cost-a.cost);const current=queue.pop();if(current.cost!==distance.get(current.key))continue;if(targets.has(current.id)){end=current;break;}
   const col=current.id%W,row=Math.floor(current.id/W),a=point(current.id);
   for(const [id,dir] of [[col?current.id-1:-1,1],[col<W-1?current.id+1:-1,1],[row?current.id-W:-1,2],[row<Y.length-1?current.id+W:-1,2]]){
    if(id<0)continue;const b=point(id),segment={x1:a.x,y1:a.y,x2:b.x,y2:b.y};if(rects.some(r=>segmentHitsRect(segment,r)))continue;
    const overlap=used.reduce((n,s)=>n+segmentOverlap(segment,s),0),length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y),cost=current.cost+length+overlap*100+(current.dir&&current.dir!==dir?clearance*2:0),key=id*3+dir;
    if(cost>=(distance.get(key)??Infinity)-eps)continue;distance.set(key,cost);previous.set(key,current);queue.push({key,id,dir,cost});
   }
  }
  if(!end)throw Object.assign(new Error('Diagram connectors have no safe whitespace route.'),{code:'PRESENTATION_LAYOUT_UNSAFE',field:`visual.diagram.edges[${edgeIndex}]`});
  const path=[];for(let step=end;step;step=previous.get(step.key))path.push(point(step.id));path.reverse();
  const compact=[];for(const p of path){const a=compact.at(-2),b=compact.at(-1);if(a&&b&&(Math.abs(a.x-b.x)<eps&&Math.abs(b.x-p.x)<eps||Math.abs(a.y-b.y)<eps&&Math.abs(b.y-p.y)<eps))compact[compact.length-1]=p;else compact.push(p);}
  const segments=compact.slice(1).map((p,i)=>({x1:compact[i].x,y1:compact[i].y,x2:p.x,y2:p.y})).filter(s=>Math.abs(s.x2-s.x1)+Math.abs(s.y2-s.y1)>eps);
  used.push(...segments);routes.push({edgeIndex,from:edge.from,to:edge.to,points:compact,segments});
 }
 return routes;
}
