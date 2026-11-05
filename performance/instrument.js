import init,{Engine} from '../pkg/confluon.js';
import {ConfluonAudio} from '../web/audio.js';
import {createRenderer} from '../web/renderer.js';
import {parsePerformanceSettings,normalizePerformanceParameter} from '../web/performance-state.js';
import {parameterUnit} from '../web/midi-mapping.js';
import {controllerBindings,CONFLUON_XL3_LAYOUT} from '../web/controller-bindings.js';
import {clientPointToWorld} from '../web/viewport-projection.js';
import {visualSmoother} from './confluon-smoothing.js';

// Only the destination is adapted. Every node, coefficient and connection inside
// the original instrument graph comes from its pinned buildGraph implementation.
class HostedAudio extends ConfluonAudio {
  async prepare(context,destination){
    if(this.context)return;
    this.buildGraph(context,destination);this.context=context;this.nextNoteTime=context.currentTime+.35;
    this.finishFade();
  }
}
const FIELDS=[
  '?seed=424242&ecology=72&flow=70&touch=88&halo=110&memory=64&tone=38&level=74&life=1600&mode=gather',
  '?seed=3950471578&ecology=104&flow=90&touch=100&halo=118&memory=56&tone=55&level=74&life=2000&mode=orbit',
  '?seed=153812312&ecology=145&flow=118&touch=118&halo=95&memory=36&tone=72&level=72&life=2600&mode=divide',
];
export class Confluon {
  constructor(canvas,trails,changed,failed){
    this.canvas=canvas;this.trails=trails;this.changed=changed;this.failed=failed;
    this.settings=parsePerformanceSettings('/');
    const supplied=Number(new URL(location.href).searchParams.get('seed'));
    this.seed=Number.isInteger(supplied)&&supplied>0&&supplied<=0xffffffff?supplied:crypto.getRandomValues(new Uint32Array(1))[0]||1;
    this.audio=new HostedAudio(this.seed);this.point={x:.5,y:.5};this.pointer={active:false,present:false,impulse:0,motion:0};
    this.active=false;this.paused=false;this.settle=false;this.accumulator=0;this.smooth=visualSmoother();
    this.layout=structuredClone(CONFLUON_XL3_LAYOUT);this.layout.buttons=this.layout.buttons.filter(b=>b[1]!==52);
    this.bindings=controllerBindings({settings:()=>this.settings,point:()=>this.point,
      setParameter:(key,value)=>{this.settings[key]=normalizePerformanceParameter(key,value);this.apply();this.audio.cueControl(key,parameterUnit(key,this.settings));},
      setPoint:(axis,value)=>{this.point[axis]=value;}});
  }
  async prepare(context,bus){
    if(this.ready)return;
    await init();this.engine??=new Engine(this.seed,this.settings.population);
    this.renderer=await createRenderer(this.canvas,this.trails,{onDeviceLost:()=>this.failed(Error('Confluon graphics device was lost'))});
    await this.audio.prepare(context,bus);this.apply();this.ready=true;
  }
  apply(){
    this.engine?.set_ecology(this.settings.ecology);
    this.renderer?.setStyle({glow:this.settings.glow,memory:this.settings.memory,core:.86+this.settings.glow*.14});
    this.audio.setPerformance(this.settings);this.audio.setTone(this.settings.tone);this.audio.setLevel(this.settings.level);
  }
  async start(){
    if(this.active)return;
    // A parked field resumes its own state, without reseeding or changing a preset.
    this.active=true;this.paused=false;this.accumulator=0;this.previousTime=performance.now()/1000;
    this.audio.setPaused(false);this.audio.wake();
  }
  position(){
    const rect=this.canvas.getBoundingClientRect();
    return clientPointToWorld(rect.left+this.point.x*rect.width,rect.top+this.point.y*rect.height,rect);
  }
  interaction(){
    const p=this.pointer,amount=this.settings.gesture,hovering=p.present;
    let strength=hovering?.24*amount:0,twist=0;
    if(p.active&&this.settings.mode==='divide'){strength=-1.22*amount;twist=-.08*amount;}
    else if(p.active&&this.settings.mode==='orbit'){strength=.12*amount;twist=1.18*amount;}
    else if(p.active)strength=amount;
    const alarm=hovering||p.active?Math.min(.9,p.motion*.22):0;
    strength-=(p.impulse*2.4+alarm)*amount;
    return {strength,twist,influencing:p.active||hovering||p.impulse>.008||(p.present&&p.motion>.008)};
  }
  tick(milliseconds){
    const time=milliseconds/1000;
    if(!this.active)return;
    const elapsed=Math.min(.05,Math.max(0,time-this.previousTime));this.previousTime=time;
    this.accumulator=Math.min(this.accumulator+elapsed*this.settings.flow,2/30);
    const position=this.position();
    if(!this.paused){
      let count=0;while(this.accumulator>=1/30&&count++<2){
        const i=this.interaction();this.engine.step(1/30,position.x,position.y,i.influencing?i.strength:0,i.influencing?i.twist:0,this.settle);
        this.pointer.impulse*=Math.exp(-(1/30)/.18);this.pointer.motion*=Math.exp(-(1/30)/.14);
        if(this.pointer.impulse<.008)this.pointer.impulse=0;if(this.pointer.motion<.008)this.pointer.motion=0;
        this.accumulator-=1/30;
      }
    }else this.accumulator=0;
    const metrics=this.engine.metrics(),visual=this.smooth(this.engine.snapshot(),metrics,elapsed);
    this.renderer.render(visual.snapshot,visual.metrics,time);
    this.audio.setInteraction({...this.interaction(),...this.pointer},position.x);
    this.audio.update(metrics,this.engine.formations());
    if(metrics[5]>.24&&(this.previousTransition||0)<=.24&&!this.paused)this.audio.strike(metrics[5],metrics[0]);
    this.previousTransition=metrics[5];this.metrics=Array.from(metrics);
  }
  action(cc,shift=false,down=true){
    if(cc===40){this.pointer.active=down;this.pointer.present=down;if(down)this.pointer.impulse=1;}
    else if(cc===41){const previous=this.settle;this.settle=down;if(previous&&!down)this.audio.strike(.58,this.engine?.metrics()[0]||0);}
    else if(!down)return;
    else if(cc>=37&&cc<=39){this.settings.mode=['gather','orbit','divide'][cc-37];this.audio.cueControl('gesture-'+this.settings.mode,(cc-37)/2);}
    else if(cc===42&&this.engine){const p=this.position();this.engine.spawn_at(p.x,p.y,50);this.audio.strike(.84,this.engine.metrics()[0],p.x);}
    else if(cc===43&&this.active){this.paused=!this.paused;this.audio.setPaused(this.paused);}
    else if(cc===44&&shift&&this.engine){this.release();this.engine.reset(this.seed);this.audio.reseed(this.seed);this.smooth=visualSmoother();this.renderer.resetTrails();this.audio.strike(.62,.5);}
    else if(cc>=45&&cc<=47){
      const url=new URL(FIELDS[cc-45],location.href);this.seed=Number(url.searchParams.get('seed'));this.settings=parsePerformanceSettings(url);
      this.audio.reseed(this.seed);
      if(this.engine){this.release();this.engine.free();this.engine=new Engine(this.seed,this.settings.population);this.smooth=visualSmoother();this.renderer.resetTrails();}
      this.apply();
    }else if(cc===48)this.release();
    this.changed();
  }
  release(){this.pointer.active=false;this.pointer.present=false;this.pointer.impulse=0;this.pointer.motion=0;this.settle=false;}
  park(){this.active=false;this.audio.finishFade();this.release();this.changed();}
}
