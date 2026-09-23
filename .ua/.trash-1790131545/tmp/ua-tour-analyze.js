const fs=require('fs');
try{
const [,,inp,out]=process.argv;const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const nodes=g.nodes||[],edges=g.edges||[],layers=g.layers||[];
const ids=new Set(nodes.map(n=>n.id));const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
const fin={},fout={};nodes.forEach(n=>{fin[n.id]=new Set();fout[n.id]=new Set();});
edges.forEach(e=>{if(!ids.has(e.source)||!ids.has(e.target)||e.source===e.target)return;fout[e.source].add(e.target);fin[e.target].add(e.source);});
const rank=(m,k)=>nodes.map(n=>({id:n.id,[k]:m[n.id].size,name:n.name})).sort((a,b)=>b[k]-a[k]).slice(0,20);
const outs=nodes.map(n=>fout[n.id].size).sort((a,b)=>a-b),ins=nodes.map(n=>fin[n.id].size).sort((a,b)=>a-b);
const p90=outs[Math.floor(outs.length*0.9)]||0,p25=ins[Math.floor(ins.length*0.25)]||0;
const EP=new Set('index.ts index.js main.ts main.js main.jsx main.tsx app.ts app.js server.ts server.js mod.rs main.go main.py main.rs manage.py app.py wsgi.py asgi.py run.py __main__.py Application.java Main.java Program.cs config.ru index.php App.swift Application.kt main.cpp main.c'.split(' '));
const cands=nodes.map(n=>{let s=0;const fp=n.filePath||'',base=fp.split('/').pop(),depth=fp.split('/').length-1;
if(n.type==='document'){if(/^readme\.md$/i.test(base)&&depth<=1)s+=5;else if(/\.md$/i.test(base)&&depth<=1)s+=2;}
else if(n.type==='file'){if(EP.has(base))s+=3;if(depth<=2)s+=1;if(fout[n.id].size>=p90&&p90>0)s+=1;if(fin[n.id].size<=p25)s+=1;}
return {id:n.id,score:s,name:n.name,summary:n.summary};}).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
const start=(cands.find(c=>byId[c.id].type!=='document')||{}).id;
const fw={};edges.forEach(e=>{if((e.type==='imports'||e.type==='calls')&&ids.has(e.source)&&ids.has(e.target))(fw[e.source]=fw[e.source]||[]).push(e.target);});
const order=[],depthMap={},byDepth={};if(start){const q=[start];depthMap[start]=0;while(q.length){const c=q.shift();order.push(c);(byDepth[depthMap[c]]=byDepth[depthMap[c]]||[]).push(c);for(const t of fw[c]||[])if(!(t in depthMap)){depthMap[t]=depthMap[c]+1;q.push(t);}}}
const pick=ts=>nodes.filter(n=>ts.includes(n.type)).map(n=>({id:n.id,name:n.name,type:n.type,summary:n.summary}));
const rel={};edges.forEach(e=>{if(e.type==='imports'||e.type==='calls')(rel[e.source+'|'+e.type]=rel[e.source+'|'+e.type]||new Set()).add(e.target);});
const clusters=[];const seen=new Set();
edges.forEach(e=>{if(!(e.type==='imports'||e.type==='calls'))return;const b=rel[e.target+'|'+e.type];if(!b||!b.has(e.source))return;const k=[e.source,e.target].sort().join('|');if(seen.has(k))return;seen.add(k);
const cl=new Set([e.source,e.target]);for(const n of nodes){if(cl.size>=5)break;if(cl.has(n.id))continue;let c=0;for(const m of cl)if(fout[n.id].has(m)||fin[n.id].has(m))c++;if(c>=2)cl.add(n.id);}
const arr=[...cl];let ec=0;edges.forEach(x=>{if(cl.has(x.source)&&cl.has(x.target))ec++;});clusters.push({nodes:arr,edgeCount:ec});});
clusters.sort((a,b)=>b.edgeCount-a.edgeCount);
const nsi={};nodes.forEach(n=>nsi[n.id]={name:n.name,type:n.type,summary:n.summary});
fs.writeFileSync(out,JSON.stringify({scriptCompleted:true,entryPointCandidates:cands,fanInRanking:rank(fin,'fanIn'),fanOutRanking:rank(fout,'fanOut'),
bfsTraversal:{startNode:start,order,depthMap,byDepth},nonCodeFiles:{documentation:pick(['document']),infrastructure:pick(['service','pipeline','resource']),data:pick(['table','schema','endpoint']),config:pick(['config'])},
clusters:clusters.slice(0,10),layers:{count:layers.length,list:layers.map(l=>({id:l.id,name:l.name,description:l.description}))},nodeSummaryIndex:nsi,totalNodes:nodes.length,totalEdges:edges.length},null,1));
}catch(e){console.error(e.stack);process.exit(1);}
