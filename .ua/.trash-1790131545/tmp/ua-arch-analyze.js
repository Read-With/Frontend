const fs=require('fs');
try{
const d=JSON.parse(fs.readFileSync(process.argv[2]));
const P='Frontend-main/src/';
const grp=n=>{const p=n.filePath;if(p.startsWith(P)){const s=p.slice(P.length).split('/');return s.length>1?s[0]:'src-root'}const s=p.split('/');return s.length>1?s[0]:'root'};
const g={},byId={},types={};
for(const n of d.fileNodes){const k=grp(n);byId[n.id]=k;(g[k]??=[]).push(n.id);(types[n.type]??=[]).push(n.id)}
const inter={},intra={},fi={},fo={},cross={};
for(const e of d.importEdges){const a=byId[e.source],b=byId[e.target];if(!a||!b)continue;fo[e.source]=(fo[e.source]||0)+1;fi[e.target]=(fi[e.target]||0)+1;
 intra[a]??={internalEdges:0,totalEdges:0};intra[b]??={internalEdges:0,totalEdges:0};
 if(a===b){intra[a].internalEdges++;intra[a].totalEdges++}else{intra[a].totalEdges++;intra[b].totalEdges++;const k=a+'->'+b;inter[k]=(inter[k]||0)+1}}
for(const v of Object.values(intra))v.density=+(v.internalEdges/v.totalEdges).toFixed(2);
const T=Object.fromEntries(d.fileNodes.map(n=>[n.id,n.type]));
for(const e of d.allEdges){const k=`${T[e.source]}|${T[e.target]}|${e.type}`;cross[k]=(cross[k]||0)+1}
const pat={pages:'ui',components:'ui',hooks:'hooks',utils:'utility',docs:'documentation','.github':'ci-cd'};
const ig=Object.entries(inter).map(([k,c])=>{const[f,t]=k.split('->');return{from:f,to:t,count:c}});
const dir=ig.filter(x=>x.count>=(inter[x.to+'->'+x.from]||0)).map(x=>({dependent:x.from,dependsOn:x.to}));
fs.writeFileSync(process.argv[3],JSON.stringify({scriptCompleted:true,directoryGroups:g,nodeTypeGroups:types,
 crossCategoryEdges:Object.entries(cross).map(([k,c])=>{const[a,b,t]=k.split('|');return{fromType:a,toType:b,edgeType:t,count:c}}),
 interGroupImports:ig,intraGroupDensity:intra,patternMatches:Object.fromEntries(Object.keys(g).map(k=>[k,pat[k]||null])),
 deploymentTopology:{hasDockerfile:false,hasCompose:false,hasK8s:false,hasTerraform:false,hasCI:false,infraFiles:d.fileNodes.filter(n=>/vercel\.json$/.test(n.filePath)).map(n=>n.filePath)},
 dependencyDirection:dir,fileStats:{totalFileNodes:d.fileNodes.length,filesPerGroup:Object.fromEntries(Object.entries(g).map(([k,v])=>[k,v.length])),nodeTypeCounts:Object.fromEntries(Object.entries(types).map(([k,v])=>[k,v.length]))},fileFanIn:fi,fileFanOut:fo},null,1));
}catch(e){console.error(e);process.exit(1)}
