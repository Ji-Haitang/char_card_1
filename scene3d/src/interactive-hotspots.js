// Floating action buttons bound to authored scene elements. Each hotspot is a
// real click target that emits an actionIntent; the host bridge maps the mesh
// name to the original business action (performAction / showTrading / …).
export const HOTSPOTS = Object.freeze({
  gate: [['Gate_stairs','下山']], fields: [['Fields_shed','耕种']],
  library: [['desk','学习'],['shelf_classics','技能习得']], alchemy: [['Alchemy_furnace','炼丹']],
  female_quarters: [['Female_screen','拜访']], training: [['Training_medallion','练武']],
  council: [['sand_table','汇报'],['bounty_board','悬赏任务'],['archive','打探传闻']],
  kitchen: [['Kitchen_firewood','打杂'],['Kitchen_counter','交易']], male_quarters: [['Male_bed_east','休息']],
  forge: [['Smith_anvil','打铁'],['Smith_weapon_rack','交易']], back_mountain: [['Ravine_cave','秘密赌场'],['Ravine_stairs','探索']],
})
export function createHotspots({ THREE, container, camera, renderer, onAction }) {
  const doc=container.ownerDocument, ns='http://www.w3.org/2000/svg'
  const layer=doc.createElement('div'); layer.className='scene3d-hotspots'; layer.setAttribute('aria-hidden','true'); layer.style.pointerEvents='none'
  const svg=doc.createElementNS(ns,'svg'); layer.appendChild(svg); container.appendChild(layer)
  let items=[],disposed=false,sceneId=null
  function clear(){for(const item of items){item.label.remove();item.line.remove()}items=[];sceneId=null;layer.hidden=true}
  function bind(root,id){clear();if(disposed||!root)return;sceneId=id;root.updateMatrixWorld(true)
    for(const [name,text]of HOTSPOTS[id]||[]){const node=root.getObjectByName(name);if(!node)continue
      const bounds=new THREE.Box3().setFromObject(node);if(bounds.isEmpty())continue
      const point=bounds.getCenter(new THREE.Vector3());point.y=bounds.max.y
      const label=doc.createElement('button');label.type='button';label.className='scene3d-hotspot';label.textContent=text;label.dataset.mesh=name
      label.setAttribute('aria-label',text)
      label.addEventListener('click',event=>{event.stopPropagation();if(!disposed)onAction?.(sceneId,name,text)})
      layer.appendChild(label)
      const line=doc.createElementNS(ns,'line');svg.appendChild(line);items.push({point,label,line})
    }
  }
  function setVisible(value){layer.hidden=disposed||!value||items.length===0}
  function update(){if(disposed||layer.hidden)return
    const rect=renderer.domElement.getBoundingClientRect(),w=container.clientWidth,h=container.clientHeight
    if(!rect.width||!rect.height||!w||!h)return
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`)
    const used=[]
    for(const item of items){const p=item.point.clone().project(camera),visible=p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1
      item.label.hidden=!visible;item.line.style.display=visible?'':'none';if(!visible)continue
      const x=(p.x+1)*w/2,y=(1-p.y)*h/2,lw=item.label.offsetWidth,lh=item.label.offsetHeight
      let left=Math.max(4,Math.min(w-lw-4,x-lw/2)),top=Math.max(4,Math.min(h-lh-4,y-lh-27))
      for(const previous of used)if(left<previous.left+previous.w+4&&left+lw+4>previous.left&&top<previous.top+previous.h+4&&top+lh+4>previous.top){top=Math.max(4,Math.min(h-lh-4,previous.top+previous.h+6))}
      used.push({left,top,w:lw,h:lh});item.label.style.left=left+'px';item.label.style.top=top+'px'
      for(const [key,value]of Object.entries({x1:x,y1:y,x2:left+lw/2,y2:top+lh}))item.line.setAttribute(key,String(value))
    }
  }
  return {bind,update,setVisible,clear,dispose(){if(disposed)return;clear();disposed=true;layer.remove()},getStats(){return {sceneId,count:items.length,visible:!layer.hidden,disposed,labels:items.map(i=>({text:i.label.textContent,mesh:i.label.dataset.mesh,visible:!layer.hidden&&!i.label.hidden}))}}}
}
