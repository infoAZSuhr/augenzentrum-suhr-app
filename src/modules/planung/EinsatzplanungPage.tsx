import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, UserProfile } from '../../lib/AuthContext'
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Check, X, Printer, Calendar, CalendarDays, User, ArrowLeftRight, UserX, GripVertical, Globe } from 'lucide-react'
import { SCHEDULE as SCHEDULE_2026, SECTIONS as SECTIONS_2026, type Code } from './data/schedule2026'
import { loadPlanung, savePlanung, loadWorkHoursFirestore, saveWorkHoursFirestore, saveYearListFirestore, type PlanungData } from '../../lib/firestorePlanung'
import { planAutoFill, autoFillUpdates, summarizeCodes } from '../../lib/planungAutoFill'
import {
  buildArztVerfuegbarkeit, buildIviVorschlaege, extractIviDaysFromPlans,
  filterIviDoctors, isoKalenderwoche, IVI_DOCTORS_MATCH, IVI_INJECTOR_MATCH, IVI_WORKING, type IviVorschlag,
} from '../../lib/iviPlanLogic'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { collection, addDoc, serverTimestamp, query, where, onSnapshot, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { manageFerienPlan, writePlanEntry, removePlanEntry } from '../../lib/firestorePlanung'
import { useToast } from '../../lib/ToastContext'
import { useBrowser } from '../../contexts/BrowserContext'

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const MONTHS_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
const WEEKDAY_SHORT = ['So','Mo','Di','Mi','Do','Fr','Sa']
const WEEKDAY_MIN   = ['S','M','D','M','D','F','S']

const CODE_STYLE: Record<string, string> = {
  // Arbeitscodes — farbig
  GT:  'bg-green-200 text-green-900',
  VM:  'bg-blue-200 text-blue-900',
  NM:  'bg-yellow-200 text-yellow-900',
  NFD: 'bg-red-400 text-white',
  // Abwesenheiten — verschiedene Grautöne
  OP:  'bg-zinc-300 text-zinc-700',
  W:   'bg-stone-300 text-stone-800',
  Fer: 'bg-slate-300 text-slate-700',
  K:   'bg-gray-400 text-gray-900',
  A:   'bg-gray-500 text-white',
  AG:  'bg-neutral-300 text-neutral-700',
  // Administrativ — eigenständige Farbe
  Ad:  'bg-amber-200 text-amber-900',
  // Telefondienst
  T:   'bg-teal-200 text-teal-900',
}
const CODE_PRINT: Record<string, string> = {
  GT:'#86efac', VM:'#93c5fd', NM:'#fde047', NFD:'#f87171',
  OP:'#d4d4d8', W:'#d6d3d1', Fer:'#94a3b8', K:'#9ca3af', A:'#6b7280', AG:'#d4d4d4',
  Ad:'#fcd34d', T:'#99f6e4',
}
// Absence codes — stay gray in year view
const YEAR_ABSENCE_CODES = new Set(['OP','W','Fer','K','A','AG','M','MV','UZ'])

// Per-person colors for year view (non-absence entries)
const YEAR_PERSON_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-rose-100 text-rose-800',
  'bg-amber-100 text-amber-800',
  'bg-cyan-100 text-cyan-800',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-lime-100 text-lime-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
]

const ALL_CODES: Code[] = ['GT','VM','NM','OP','W','Fer','K','NFD','A','Ad','AG','T']
const CODE_LABELS: Record<string, string> = {
  GT:'Ganztag', VM:'Vormittag', NM:'Nachmittag', OP:'OP KSA', W:'Weiterbildung',
  Fer:'Ferien', K:'Krank', NFD:'Notfalldienst', A:'Abwesend', Ad:'Administrativ', AG:'Ausgleich',
  T:'Telefondienst',
}
const WORK_CODES = new Set(['GT','VM','NM','NFD','OP','W','T'])
// Codes that count as physically present at the clinic (for MPA requirement)
const CLINIC_CODES = new Set(['GT','VM','NM'])
const KIRR_NAME = 'Kirr'  // partial match — checks if person name includes this string

// ── Working hours ─────────────────────────────────────────────────────────────

interface PersonHours {
  dayStart: string; dayEnd: string
  vmEnd: string; nmStart: string
  lunchStart: string; lunchEnd: string
}
const DEFAULT_HOURS: PersonHours = {
  dayStart:'06:00', dayEnd:'19:00',
  vmEnd:'12:00', nmStart:'13:00',
  lunchStart:'12:00', lunchEnd:'13:00',
}
type WorkHoursStore = Record<string, PersonHours>
function getHours(person:string,wh:WorkHoursStore):PersonHours{return{...DEFAULT_HOURS,...(wh[person]??{})}}

// ── Blocker calculation ───────────────────────────────────────────────────────

interface Blocker{date:string;start:string;end:string;reason:string}
function calcBlockers(person:string,days:DayInfo[],schedule:Record<string,Record<string,string>>,wh:WorkHoursStore,feiertage:Record<string,string>):Blocker[]{
  const h=getHours(person,wh)
  const out:Blocker[]=[]
  for(const day of days){
    if(day.isWeekend)continue
    if(feiertage[day.key])continue
    const code=schedule[person]?.[day.key]
    if(!code||!WORK_CODES.has(code)){
      out.push({date:day.key,start:h.dayStart,end:h.dayEnd,reason:'Kein Einsatz geplant'})
    } else if(code==='GT'||code==='NFD'||code==='OP'){
      out.push({date:day.key,start:h.lunchStart,end:h.lunchEnd,reason:'Mittagspause'})
    } else if(code==='VM'){
      out.push({date:day.key,start:h.vmEnd,end:h.dayEnd,reason:'Nachmittag gesperrt'})
    } else if(code==='NM'){
      out.push({date:day.key,start:h.dayStart,end:h.nmStart,reason:'Vormittag gesperrt'})
    }
  }
  return out
}

// ── Feiertage ────────────────────────────────────────────────────────────────

function easterSunday(year: number): Date {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3)
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451)
  const mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1
  return new Date(year,mo-1,dy)
}
function addDays(d:Date,n:number):Date{const r=new Date(d);r.setDate(r.getDate()+n);return r}
function fmt(d:Date):string{return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

function getFeiertage(year:number):Record<string,string>{
  const e=easterSunday(year)
  return {
    [`${year}-01-01`]:'Neujahr', [`${year}-01-02`]:'Berchtoldstag',
    [fmt(addDays(e,-2))]:'Karfreitag', [fmt(addDays(e,1))]:'Ostermontag',
    [fmt(addDays(e,39))]:'Auffahrt', [fmt(addDays(e,50))]:'Pfingstmontag',
    [`${year}-08-01`]:'Nationalfeiertag', [`${year}-12-25`]:'Weihnachten', [`${year}-12-26`]:'Stephanstag',
  }
}
const FT_SHORT:Record<string,string>={
  'Neujahr':'Neu','Berchtoldstag':'Ber','Karfreitag':'Kar','Ostermontag':'Ost',
  'Auffahrt':'Auf','Pfingstmontag':'Pfi','Nationalfeiertag':'Nat','Weihnachten':'Wnh','Stephanstag':'Ste',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getKW(dateStr: string): number {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7)
}

function isoDate(y:number,m:number,d:number){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function defaultData():PlanungData{return{sections:SECTIONS_2026,schedule:SCHEDULE_2026}}
const TODAY=isoDate(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate())

// ── Day info ──────────────────────────────────────────────────────────────────

interface DayInfo{d:number;key:string;dow:number;isWeekend:boolean;ftName?:string;monthIdx:number;isCurrentMonth?:boolean}

function getYearDays(year:number,feiertage:Record<string,string>):DayInfo[]{
  const result:DayInfo[]=[]
  for(let m=0;m<12;m++){
    const days=new Date(year,m+1,0).getDate()
    for(let d=1;d<=days;d++){
      const key=isoDate(year,m+1,d)
      const dow=new Date(year,m,d).getDay()
      result.push({d,key,dow,isWeekend:dow===0||dow===6,ftName:feiertage[key],monthIdx:m})
    }
  }
  return result
}

function getMonthDays(year:number,monthIdx:number,feiertage:Record<string,string>):DayInfo[]{
  const days=new Date(year,monthIdx+1,0).getDate()
  const firstDow=new Date(year,monthIdx,1).getDay()
  const lastDay=days
  const lastDow=new Date(year,monthIdx,lastDay).getDay()

  const result:DayInfo[]=[]

  // Add days from previous month (start of week)
  if(firstDow>0){
    const prevMonthDays=new Date(year,monthIdx,0).getDate()
    for(let d=prevMonthDays-firstDow+1;d<=prevMonthDays;d++){
      const prevMonth=monthIdx===0?11:monthIdx-1
      const prevYear=monthIdx===0?year-1:year
      const key=isoDate(prevYear,prevMonth+1,d)
      const dow=new Date(prevYear,prevMonth,d).getDay()
      result.push({d,key,dow,isWeekend:dow===0||dow===6,ftName:feiertage[key],monthIdx:prevMonth,isCurrentMonth:false})
    }
  }

  // Add days of current month
  for(let d=1;d<=days;d++){
    const key=isoDate(year,monthIdx+1,d)
    const dow=new Date(year,monthIdx,d).getDay()
    result.push({d,key,dow,isWeekend:dow===0||dow===6,ftName:feiertage[key],monthIdx,isCurrentMonth:true})
  }

  // Add days from next month (end of week)
  if(lastDow<6){
    const nextMonthDays=6-lastDow
    const nextMonth=monthIdx===11?0:monthIdx+1
    const nextYear=monthIdx===11?year+1:year
    for(let d=1;d<=nextMonthDays;d++){
      const key=isoDate(nextYear,nextMonth+1,d)
      const dow=new Date(nextYear,nextMonth,d).getDay()
      result.push({d,key,dow,isWeekend:dow===0||dow===6,ftName:feiertage[key],monthIdx:nextMonth,isCurrentMonth:false})
    }
  }

  return result
}

// ── Print ─────────────────────────────────────────────────────────────────────

function buildMonthHTML(year:number,monthIdx:number,data:PlanungData,feiertage:Record<string,string>,pageBreak=true):string{
  const days=getMonthDays(year,monthIdx,feiertage)
  const BD='1px solid #9ca3af'
  const hdr=days.map(({d,dow,isWeekend,ftName,key,isCurrentMonth},i)=>{
    const bg=isCurrentMonth?(ftName?'#fed7aa':isWeekend?'#f3f4f6':'#f9fafb'):'#f3f4f6'
    const co=isCurrentMonth?(ftName?'#c2410c':isWeekend?'#9ca3af':'#6b7280'):'#d1d5db'
    const ft=ftName&&isCurrentMonth?`<div style="font-size:7px;color:#ea580c">${FT_SHORT[ftName]??ftName.slice(0,3)}</div>`:''
    const showKW=dow===1||(i===0&&dow!==0)
    const kwLine=showKW&&isCurrentMonth?`<div style="font-size:6px;font-weight:700;color:#6366f1">KW${getKW(key)}</div>`:''
    return`<th style="width:22px;text-align:center;padding:2px 0;background:${bg};color:${co};border:${BD};opacity:${isCurrentMonth?'1':'0.6'}">
      ${kwLine}<div style="font-size:9px;font-weight:600">${d}</div>
      <div style="font-size:7px;color:#9ca3af">${WEEKDAY_MIN[dow]}</div>${ft}</th>`
  }).join('')
  let rows=''
  const arzteSection=data.sections[0]
  for(const s of data.sections){
    if(s.label==='Mitarbeiter SU'){
      // Special header row: show actual/required counts per day (same as screen view)
      const hdrCells=days.map(({key,isWeekend,ftName})=>{
        if(isWeekend||ftName) return`<td style="width:22px;border:${BD};background:#f3f4f6"/>`;
        const workingAerzte=(arzteSection?.persons??[]).filter(p=>{const c=data.schedule[p]?.[key];return!!(c&&CLINIC_CODES.has(c))})
        const kirrPresent=workingAerzte.some(p=>p.includes(KIRR_NAME))
        const doctorFTE=workingAerzte.reduce((s,p)=>{const c=data.schedule[p]?.[key];return s+(c==='GT'?1:0.5)},0)
        const required=kirrPresent?4:doctorFTE>=2?3:workingAerzte.length===0?1:2
        const actual=s.persons.filter(p=>{const c=data.schedule[p]?.[key];return!!(c&&CLINIC_CODES.has(c))}).length
        const met=actual>=required
        return`<td style="width:22px;text-align:center;padding:1px 0;background:#f3f4f6;border:${BD};font-size:8px;font-weight:800;color:${met?'#16a34a':'#dc2626'};-webkit-print-color-adjust:exact;print-color-adjust:exact">${actual}/${required}</td>`
      }).join('')
      rows+=`<tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact">
        <td style="padding:2px 6px;font-size:9px;font-weight:700;text-transform:uppercase;border:${BD};background:#f3f4f6;white-space:nowrap;min-width:110px">${s.label}</td>${hdrCells}</tr>`
    }else{
      rows+=`<tr><td colspan="${days.length+1}" style="background:#f3f4f6;padding:3px 6px;font-size:9px;font-weight:700;text-transform:uppercase;border:${BD};-webkit-print-color-adjust:exact;print-color-adjust:exact">${s.label}</td></tr>`
    }
    for(const p of s.persons){
      const ps=data.schedule[p]??{}
      const cells=days.map(({key,isWeekend,ftName,isCurrentMonth})=>{
        const code=ps[key]
        const bg=code?(CODE_PRINT[code]??'#f9fafb'):ftName?'#fff7ed':isWeekend?'#f9fafb':'#fff'
        return`<td style="width:22px;text-align:center;padding:1px 0;background:${bg};border:${BD};font-size:7px;font-weight:700;opacity:${isCurrentMonth?'1':'0.6'};-webkit-print-color-adjust:exact;print-color-adjust:exact">${code??''}</td>`
      }).join('')
      rows+=`<tr><td style="padding:2px 6px;font-size:9px;border:${BD};white-space:nowrap;min-width:110px">${p}</td>${cells}</tr>`
    }
  }
  return`<div data-month-block style="${pageBreak?'page-break-after:always;':''}margin-bottom:4px">
    <h2 style="font-size:12px;font-weight:700;margin:0 0 4px">${MONTHS[monthIdx]} ${year}</h2>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif">
      <thead><tr><th style="min-width:110px;text-align:left;padding:2px 6px;font-size:9px;border:${BD};background:#f9fafb">Person</th>${hdr}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
}
const PRINT_CSS=`@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{font-family:Arial,sans-serif;font-size:9px;margin:0}table{border-collapse:collapse}h1{font-size:14px;margin:0 0 8px}h2{font-size:12px;font-weight:700;margin:4px 0 3px}`

function buildLegendHTML():string{
  return`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px">${ALL_CODES.map(c=>`<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;font-size:8px;background:${CODE_PRINT[c]??'#f3f4f6'};-webkit-print-color-adjust:exact;print-color-adjust:exact"><b>${c}</b> ${CODE_LABELS[c]}</span>`).join('')}</div>`
}
function printViaIframe(html:string){
  // Echtes Hidden-Iframe. Vorher wurde window.open('','_blank') verwendet —
  // in der Electron-App (und bei aktiviertem Popup-Blocker im Browser)
  // konnte das blockiert werden oder ein leeres Fenster aufmachen, das die
  // Jahresansicht-Druckung scheitern liess.
  const iframe=document.createElement('iframe')
  iframe.style.position='fixed'
  iframe.style.right='0'
  iframe.style.bottom='0'
  iframe.style.width='0'
  iframe.style.height='0'
  iframe.style.border='0'
  iframe.style.visibility='hidden'
  document.body.appendChild(iframe)
  const cleanup=()=>{ try{document.body.removeChild(iframe)}catch{/* schon entfernt */} }
  iframe.onload=()=>{
    // Kurz warten damit Styles + Inhalte gerendert sind, dann print
    setTimeout(()=>{
      try{
        const cw=iframe.contentWindow
        if(!cw){cleanup();return}
        cw.focus()
        cw.print()
        // afterprint feuert nicht zuverlaessig in allen Engines -> Fallback-Timeout
        let cleaned=false
        const doCleanup=()=>{ if(cleaned)return; cleaned=true; cleanup() }
        cw.onafterprint=doCleanup
        setTimeout(doCleanup,60000)
      }catch{cleanup()}
    },200)
  }
  // srcdoc statt document.write — funktioniert robuster (insbes. in Electron).
  iframe.srcdoc=html
}

// Build year calendar HTML matching screen view (months side by side, names in cells)
function buildYearCalendarSectionHTML(year:number,section:{label:string;persons:string[]},data:PlanungData,feiertage:Record<string,string>):string{
  const allDays=getYearDays(year,feiertage)
  const byMonth:DayInfo[][]=Array.from({length:12},(_,mi)=>allDays.filter(d=>d.monthIdx===mi))
  const monthCards=byMonth.map((days,mi)=>{
    const rows=days.map(day=>{
      const assigned=section.persons.map(p=>({p,code:data.schedule[p]?.[day.key]})).filter(({code})=>!!code)
      if(day.isWeekend&&assigned.length===0&&!day.ftName)return''
      const isFt=!!day.ftName;const isWe=day.isWeekend
      const rowBg=isFt?'#fff7ed':isWe?'#f9fafb':'#fff'
      const dateCo=isFt?'#c2410c':isWe?'#d1d5db':'#6b7280'
      const names=assigned.map(({p,code})=>{
        const short=p.includes(' ')?p.split(' ')[0]:p
        return`<span style="display:inline-block;padding:0 3px;margin-right:2px;border-radius:2px;font-size:7px;font-weight:700;background:${CODE_PRINT[code!]??'#f3f4f6'};-webkit-print-color-adjust:exact;print-color-adjust:exact">${short} ${code}</span>`
      }).join('')
      const ftLabel=day.ftName?`<span style="font-size:7px;color:#c2410c;font-weight:700">${day.ftName} </span>`:''
      return`<tr style="background:${rowBg};-webkit-print-color-adjust:exact;print-color-adjust:exact">
        <td style="padding:1px 2px;font-size:7.5px;font-weight:600;color:${dateCo};white-space:nowrap;border-bottom:1px solid #f3f4f6;width:30px">${WEEKDAY_SHORT[day.dow]} ${day.d}.</td>
        <td style="padding:1px 2px;border-bottom:1px solid #f3f4f6;font-size:7px">${ftLabel}${names}</td>
      </tr>`
    }).join('')
    return`<div style="border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;break-inside:avoid">
      <div style="background:#1e3a8a;color:#fff;padding:3px 5px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;-webkit-print-color-adjust:exact;print-color-adjust:exact">${MONTHS[mi]} ${year}</div>
      <table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>
    </div>`
  }).join('')
  return`<h2 style="font-size:13px;font-weight:700;margin:0 0 5px">${section.label} – Jahresplanung ${year}</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${monthCards}</div>`
}

function printMonthly(year:number,mi:number,data:PlanungData,ft:Record<string,string>){
  // A4 landscape minus 2×8 mm margins: 281 mm × 194 mm → at 96 dpi ≈ 1062 × 733 px
  printViaIframe(`<!DOCTYPE html><html><head><title>Einsatzplanung ${MONTHS[mi]} ${year}</title>
    <style>
      @page{size:A4 landscape;margin:8mm}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
      body{font-family:Arial,sans-serif;font-size:9px;margin:0;transform-origin:0 0}
      table{border-collapse:collapse}
      h1{font-size:14px;margin:0 0 6px}
      h2{font-size:12px;font-weight:700;margin:4px 0 3px}
    </style>
    <script>
      window.addEventListener('load',function(){
        var availW=281/25.4*96;
        var availH=194/25.4*96;
        var sw=document.body.scrollWidth;
        var sh=document.body.scrollHeight;
        var s=Math.min(availW/sw,availH/sh);
        document.body.style.zoom=s.toFixed(4);
      });
    <\/script>
  </head><body><h1>Einsatzplanung Suhr – ${MONTHS[mi]} ${year}</h1>
    ${buildMonthHTML(year,mi,data,ft,false)}${buildLegendHTML()}</body></html>`)
}
function printAnnual(year:number,data:PlanungData,ft:Record<string,string>){
  const content=Array.from({length:12},(_,i)=>buildMonthHTML(year,i,data,ft)).join('')
  // A4 landscape minus 2×8 mm margins: 281 mm × 194 mm → at 96 dpi ≈ 1062 × 733 px
  printViaIframe(`<!DOCTYPE html><html><head><title>Einsatzplanung ${year}</title>
    <style>
      @page{size:A4 landscape;margin:8mm}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
      body{font-family:Arial,sans-serif;font-size:9px;margin:0;transform-origin:0 0}
      table{border-collapse:collapse}
      h1{font-size:14px;margin:0 0 6px}
      h2{font-size:12px;font-weight:700;margin:4px 0 3px}
    </style>
    <script>
      window.addEventListener('load',function(){
        var availW=281/25.4*96;
        var availH=194/25.4*96;
        var blocks=document.querySelectorAll('[data-month-block]');
        var maxW=0,maxH=0;
        blocks.forEach(function(b){
          maxW=Math.max(maxW,b.scrollWidth);
          maxH=Math.max(maxH,b.scrollHeight);
        });
        if(!maxW)maxW=document.body.scrollWidth;
        if(!maxH)maxH=document.body.scrollHeight/12;
        var s=Math.min(availW/maxW,availH/maxH);
        document.body.style.zoom=s.toFixed(4);
      });
    <\/script>
  </head><body><h1>Einsatzplanung Suhr – Jahresplanung ${year}</h1>
    ${content}${buildLegendHTML()}</body></html>`)
}

function printYearSection(year:number,section:{label:string;persons:string[]},data:PlanungData,ft:Record<string,string>){
  printViaIframe(`<!DOCTYPE html><html><head><title>${section.label} – Jahresplanung ${year}</title>
    <style>${PRINT_CSS}</style>
  </head><body>${buildYearCalendarSectionHTML(year,section,data,ft)}${buildLegendHTML()}</body></html>`)
}

function printPersonDetail(person:string,data:PlanungData,yearDays:DayInfo[]){
  const year=yearDays[0]?.key.slice(0,4)??String(new Date().getFullYear())
  const ps=data.schedule[person]??{}
  const byMonth:Record<number,Array<{day:DayInfo;code:string}>>={}
  for(const day of yearDays){
    if(day.isWeekend)continue
    const code=ps[day.key]
    if(code&&WORK_CODES_SET.has(code)){
      if(!byMonth[day.monthIdx])byMonth[day.monthIdx]=[]
      byMonth[day.monthIdx].push({day,code})
    }
  }
  const total=Object.values(byMonth).reduce((s,a)=>s+a.reduce((ss,{code})=>ss+(code==='VM'||code==='NM'?0.5:1),0),0)
  const pensum=data.pensum?.[person]
  const pensumLine=pensum!=null?` · Pensum: ${pensum}%`:''
  let monthsHTML=''
  for(const [mi,entries] of Object.entries(byMonth)){
    const mt=entries.reduce((s,{code})=>s+(code==='VM'||code==='NM'?0.5:1),0)
    const badges=entries.map(({day,code})=>`<span style="display:inline-block;padding:2px 7px;margin:2px;border-radius:4px;font-size:8px;font-weight:600;background:${CODE_PRINT[code]??'#f3f4f6'};-webkit-print-color-adjust:exact;print-color-adjust:exact">${WEEKDAY_SHORT[day.dow]} ${day.d}. — ${code}</span>`).join('')
    monthsHTML+=`<div style="margin-bottom:10px;break-inside:avoid"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:4px;border-bottom:1px solid #e5e7eb;padding-bottom:2px">${MONTHS[Number(mi)]} — ${mt} Tage</div><div>${badges}</div></div>`
  }
  printViaIframe(`<!DOCTYPE html><html><head><title>${person} – Arbeitstage ${year}</title>
    <style>@page{size:A4 portrait;margin:15mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{font-family:Arial,sans-serif;font-size:9px;margin:0}</style>
  </head><body>
    <h1 style="font-size:15px;font-weight:700;margin:0 0 2px">${person}</h1>
    <p style="font-size:9px;color:#6b7280;margin:0 0 12px">${total} geplante Arbeitstage ${year} (VM/NM = ½ Tag)${pensumLine}</p>
    ${monthsHTML||'<p style="color:#9ca3af">Keine Arbeitstage geplant</p>'}
  </body></html>`)
}

// ── Helpers for open days ─────────────────────────────────────────────────────

const WORK_CODES_SET=new Set(['GT','VM','NM','NFD','OP','W','T'])

function getOpenDays(data:PlanungData,yearDays:DayInfo[]):DayInfo[]{
  const aerzte=data.sections[0]
  return yearDays.filter(day=>{
    if(day.isWeekend||day.ftName)return false
    return!aerzte.persons.some(p=>{
      const code=data.schedule[p]?.[day.key]
      return code&&WORK_CODES_SET.has(code)
    })
  })
}

const VM_CODES_SET=new Set(['GT','VM','NFD','OP','W','T'])  // codes that cover Vormittag
const NM_CODES_SET=new Set(['GT','NM','NFD','OP','W','T'])  // codes that cover Nachmittag
interface OpenHalfDay{day:DayInfo;vmOpen:boolean;nmOpen:boolean;gtCount:number;totalCount:number;vmCount:number;nmCount:number}
function getOpenHalfDays(data:PlanungData,yearDays:DayInfo[]):OpenHalfDay[]{
  const aerzte=data.sections[0]
  return yearDays
    .filter(day=>!day.isWeekend&&!day.ftName)
    .map(day=>{
      const codes=aerzte.persons.map(p=>data.schedule[p]?.[day.key]).filter((c):c is string=>!!(c&&WORK_CODES_SET.has(c)))
      const vmCount=codes.filter(c=>VM_CODES_SET.has(c)).length  // how many doctors cover VM
      const nmCount=codes.filter(c=>NM_CODES_SET.has(c)).length  // how many doctors cover NM
      const gtCount=codes.filter(c=>c==='GT').length
      const totalCount=codes.length
      return{day,vmOpen:vmCount<2,nmOpen:nmCount<2,gtCount,totalCount,vmCount,nmCount}
    })
    .filter(({vmOpen,nmOpen})=>vmOpen||nmOpen)  // day has capacity in at least one slot
}

// ── Doctor detail modal ───────────────────────────────────────────────────────

function DoctorDetailModal({person,data,yearDays,year,onClose}:{
  person:string;data:PlanungData;yearDays:DayInfo[];year:number;onClose:()=>void
}){
  const ps=data.schedule[person]??{}
  type Entry={day:DayInfo;code:string}
  const byMonth:Record<number,Entry[]>={}
  for(const day of yearDays){
    if(day.isWeekend)continue
    const code=ps[day.key]
    if(code&&WORK_CODES_SET.has(code)){
      if(!byMonth[day.monthIdx])byMonth[day.monthIdx]=[]
      byMonth[day.monthIdx].push({day,code})
    }
  }
  const total=Object.values(byMonth).reduce((s,a)=>s+a.reduce((ss,{code})=>ss+(code==='VM'||code==='NM'?0.5:1),0),0)
  return(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{person}</h2>
            <p className="text-sm text-gray-500">{total} geplante Arbeitstage <span className="text-gray-400 font-normal">(VM/NM = ½ Tag)</span></p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={()=>printPersonDetail(person,data,yearDays)} className="p-1 rounded-lg hover:bg-gray-100" title="Drucken"><Printer className="w-5 h-5 text-gray-400"/></button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
          </div>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {Object.entries(byMonth).map(([mi,entries])=>(
            <div key={mi}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">{MONTHS[Number(mi)]} — {entries.reduce((s,{code})=>s+(code==='VM'||code==='NM'?0.5:1),0)} Tage</div>
              <div className="flex flex-wrap gap-1">
                {entries.map(({day,code})=>(
                  <span key={day.key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${CODE_STYLE[code]??'bg-gray-100 text-gray-700'}`}>
                    {WEEKDAY_SHORT[day.dow]} {day.d}. — {code}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {total===0&&<p className="text-center text-gray-400 py-6">Keine Arbeitstage geplant</p>}

          <AutoFillSection person={person} data={data} yearDays={yearDays} year={year}/>
        </div>
      </div>
    </div>
  )
}

// ── Arbeitstage automatisch eintragen ─────────────────────────────────────────
// Wochenrhythmus (welche Wochentage, welcher Code) + Intervall (jede Woche,
// alle 2 Wochen …) auf einen Monat oder das ganze Jahr anwenden.
// Feiertage werden immer uebersprungen; bestehende Eintraege (Ferien, Krank …)
// bleiben stehen, sofern nicht explizit ueberschrieben wird.

const AUTOFILL_CODES:Code[]=['GT','VM','NM']
const AUTOFILL_DOWS:{dow:number;label:string}[]=[
  {dow:1,label:'Mo'},{dow:2,label:'Di'},{dow:3,label:'Mi'},
  {dow:4,label:'Do'},{dow:5,label:'Fr'},{dow:6,label:'Sa'},
]

function AutoFillSection({person,data,yearDays,year}:{
  person:string;data:PlanungData;yearDays:DayInfo[];year:number
}){
  const [open,setOpen]=useState(false)
  const [weekdayCodes,setWeekdayCodes]=useState<Record<number,string>>({})
  const [intervalWeeks,setIntervalWeeks]=useState(1)
  const todayIso=new Date().toISOString().slice(0,10)
  const [startDate,setStartDate]=useState(
    todayIso.slice(0,4)===String(year)?todayIso:`${year}-01-01`
  )
  const [scope,setScope]=useState<'jahr'|'monat'>('monat')
  const [monthIdx,setMonthIdx]=useState(new Date().getMonth())
  const [overwrite,setOverwrite]=useState(false)
  const [saving,setSaving]=useState(false)
  const [done,setDone]=useState<string|null>(null)
  const [confirmOpen,setConfirmOpen]=useState(false)

  const existing=data.schedule[person]??{}
  const plan=useMemo(()=>planAutoFill(
    yearDays.map(d=>({key:d.key,dow:d.dow,monthIdx:d.monthIdx,ftName:d.ftName})),
    existing,
    {weekdayCodes,intervalWeeks,startDate,monthIdx:scope==='jahr'?null:monthIdx,overwrite},
  ),[yearDays,existing,weekdayCodes,intervalWeeks,startDate,scope,monthIdx,overwrite])

  const anyDay=Object.keys(weekdayCodes).length>0

  const write=async()=>{
    setSaving(true);setDone(null)
    try{
      await updateDoc(doc(db,'planung',String(year)),autoFillUpdates(person,plan))
      setDone(`${plan.toWrite.length} Tage eingetragen`)
      setWeekdayCodes({})
    }catch(e){
      console.error(e);setDone('Fehler beim Speichern')
    }finally{setSaving(false);setConfirmOpen(false)}
  }

  // Bestehende Eintraege werden nur nach ausdruecklicher Bestaetigung ersetzt.
  const apply=()=>{
    if(plan.toWrite.length===0)return
    if(plan.overwritten.length>0){setConfirmOpen(true);return}
    void write()
  }

  if(!open){
    return(
      <button onClick={()=>setOpen(true)}
        className="w-full mt-2 py-2 rounded-lg border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors">
        + Arbeitstage automatisch eintragen
      </button>
    )
  }

  return(
    <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">Arbeitstage automatisch eintragen</span>
        <button onClick={()=>setOpen(false)} className="p-0.5 rounded hover:bg-gray-200"><X className="w-4 h-4 text-gray-400"/></button>
      </div>
      <div className="p-3 space-y-3">

        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Wochentage</div>
          <div className="grid grid-cols-6 gap-1">
            {AUTOFILL_DOWS.map(({dow,label})=>(
              <div key={dow} className="text-center">
                <div className="text-[11px] font-semibold text-gray-500 mb-0.5">{label}</div>
                <select value={weekdayCodes[dow]??''} onChange={e=>{
                  const v=e.target.value
                  setWeekdayCodes(prev=>{
                    const next={...prev}
                    if(v)next[dow]=v; else delete next[dow]
                    return next
                  })
                }} className="w-full text-xs border border-gray-200 rounded px-0.5 py-1 bg-white">
                  <option value="">–</option>
                  {AUTOFILL_CODES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Intervall</div>
            <select value={intervalWeeks} onChange={e=>setIntervalWeeks(Number(e.target.value))}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              <option value={1}>jede Woche</option>
              <option value={2}>alle 2 Wochen</option>
              <option value={3}>alle 3 Wochen</option>
              <option value={4}>alle 4 Wochen</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Ab Datum</div>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
              min={`${year}-01-01`} max={`${year}-12-31`}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"/>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Zeitraum</div>
          <div className="flex gap-2">
            <button onClick={()=>setScope('monat')}
              className={`flex-1 text-xs py-1.5 rounded border-2 font-medium ${scope==='monat'?'border-primary-400 bg-primary-50 text-primary-700':'border-gray-200 text-gray-500'}`}>
              Nur Monat
            </button>
            <button onClick={()=>setScope('jahr')}
              className={`flex-1 text-xs py-1.5 rounded border-2 font-medium ${scope==='jahr'?'border-primary-400 bg-primary-50 text-primary-700':'border-gray-200 text-gray-500'}`}>
              Ganzes Jahr {year}
            </button>
          </div>
          {scope==='monat'&&(
            <select value={monthIdx} onChange={e=>setMonthIdx(Number(e.target.value))}
              className="w-full mt-1.5 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
              {MONTHS.map((m,i)=><option key={m} value={i}>{m}</option>)}
            </select>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={overwrite} onChange={e=>setOverwrite(e.target.checked)} className="mt-0.5"/>
          <span>
            Bestehende Einträge überschreiben
            <span className="block text-[10px] text-amber-700">
              Achtung: ersetzt auch Ferien / Krank / Abwesend. Feiertage bleiben immer unangetastet.
            </span>
          </span>
        </label>

        {anyDay&&(
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2 text-xs space-y-0.5">
            <div className="font-bold text-gray-700">{plan.toWrite.length} Tage werden eingetragen</div>
            {plan.skippedExisting.length>0&&(
              <div className="text-gray-500">{plan.skippedExisting.length} bleiben unverändert (bestehender Eintrag)</div>
            )}
            {plan.skippedHoliday.length>0&&(
              <div className="text-gray-500">{plan.skippedHoliday.length} Feiertage übersprungen</div>
            )}
            {plan.overwritten.length>0&&(
              <div className="font-semibold text-red-700">
                davon {plan.overwritten.length} bestehende ersetzt ({summarizeCodes(plan.overwritten)})
              </div>
            )}
            {plan.toWrite.length>0&&(
              <div className="text-gray-400 pt-0.5">
                {plan.toWrite.slice(0,4).map(w=>w.key.slice(8,10)+'.'+w.key.slice(5,7)+'.').join(', ')}
                {plan.toWrite.length>4?` … +${plan.toWrite.length-4}`:''}
              </div>
            )}
          </div>
        )}

        {done&&<div className="text-xs font-medium text-green-700 bg-green-50 rounded-lg px-2.5 py-1.5">{done}</div>}

        <button onClick={apply} disabled={saving||plan.toWrite.length===0}
          className="w-full py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-semibold">
          {saving?'Wird eingetragen…':`${plan.toWrite.length} Tage eintragen`}
        </button>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Ausnahmen wie Ferien, Weiterbildung oder Notfalldienst danach von Hand umstellen.
        </p>
      </div>

      {confirmOpen&&(
        <ConfirmDialog
          title="Bestehende Einträge überschreiben?"
          confirmLabel={`${plan.overwritten.length} überschreiben`}
          danger
          isLoading={saving}
          message={
            `Bei ${person} werden ${plan.overwritten.length} bestehende Einträge ersetzt: `
            +`${summarizeCodes(plan.overwritten)}.\n\n`
            +plan.overwritten.slice(0,8).map(o=>`${o.key.slice(8,10)}.${o.key.slice(5,7)}.  ${o.oldCode} → ${o.newCode}`).join('\n')
            +(plan.overwritten.length>8?`\n… und ${plan.overwritten.length-8} weitere`:'')
            +`\n\nDas kann nicht rückgängig gemacht werden. Feiertage bleiben unangetastet.`
          }
          onConfirm={()=>void write()}
          onCancel={()=>setConfirmOpen(false)}
        />
      )}
    </div>
  )
}

// ── IVI-Tage vorschlagen ──────────────────────────────────────────────────────
// Schlaegt im 14-Tage-Montagsraster IVI-Tage vor (Feiertag/Abwesenheit ->
// Ausweich auf Do/Fr DERSELBEN Woche) und zeigt, was pro Tag noch fehlt.
// Eintragen darf: Admin/GL direkt, Tschopp/Trachsler fuer sich selbst per
// Anfrage — analog OpenDaysModal.

const VORSCHLAG_STYLE: Record<string, { bg: string; label: string }> = {
  bereit:           { bg: 'bg-green-50 border-green-200',   label: 'IVI möglich' },
  partner_fehlt:    { bg: 'bg-amber-50 border-amber-200',   label: 'Partner fehlt' },
  halbtag_konflikt: { bg: 'bg-blue-50 border-blue-200',     label: 'Halbtag-Konflikt' },
  kein_tag:         { bg: 'bg-gray-50 border-gray-200',     label: 'Artemiev abwesend' },
}

function IviVorschlagModal({data,yearDays,year,feiertage,onClose,onAssign}:{
  data:PlanungData;yearDays:DayInfo[];year:number
  feiertage:Record<string,string>
  onClose:()=>void
  onAssign:(person:string,days:string[],code:Code)=>void
}){
  const {isAdmin,isGeschaeftsleitung,profile}=useAuth()
  const canDirect=isAdmin||isGeschaeftsleitung
  const allPersons=data.sections.flatMap(s=>s.persons)
  const partners=filterIviDoctors(allPersons,IVI_DOCTORS_MATCH)
  const eigenerName=allPersons.find(p=>p===profile?.displayName)||allPersons.find(p=>p===profile?.username)||''
  const istPartner=partners.includes(eigenerName)

  // Bisherige IVI-Einsaetze je Partner — Entscheidungshilfe bei der Auswahl.
  const einsaetze=useMemo(()=>{
    const m:Record<string,number>={}
    partners.forEach(p=>{
      m[p]=Object.entries(data.schedule[p]??{}).filter(([d,c])=>d>=TODAY&&IVI_WORKING.has(c)).length
    })
    return m
  },[data,partners.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const vorschlaege=useMemo(()=>{
    const verf=buildArztVerfuegbarkeit([data],TODAY)
    const best=extractIviDaysFromPlans([data],TODAY)
    // Roh-Schedule des Injektors mitgeben, damit «Fer»/«W» als Grund erscheint
    const injName=filterIviDoctors(allPersons,IVI_INJECTOR_MATCH)[0]
    const injSched=injName?(data.schedule[injName]??{}):{}
    return buildIviVorschlaege(verf,TODAY,`${year}-12-31`,feiertage,best,injSched)
  },[data,year,feiertage])

  // Bereits stehende IVI-Tage: ALLE Tage ab heute, an denen Injektor + Partner
  // zusammenpassen — unabhaengig vom Vorschlags-Raster (Nutzerwunsch
  // 2026-07-22: «Tage ab heute anzeigen»). Sonst fehlten reale Termine in
  // geraden KW bzw. an Ausweichtagen (Do/Fr).
  const geplant=useMemo(()=>
    buildArztVerfuegbarkeit([data],TODAY)
      .filter(t=>t.passend&&t.date>=TODAY&&!feiertage[t.date])
      .sort((a,b)=>a.date.localeCompare(b.date)),
  [data,feiertage])

  // Pro Vorschlagstag der gewaehlte Partner (Default: der mit weniger Einsaetzen)
  const defaultPartner=[...partners].sort((a,b)=>(einsaetze[a]??0)-(einsaetze[b]??0))[0]??''
  const [wahl,setWahl]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState<string|null>(null)
  const [fehler,setFehler]=useState<string|null>(null)
  const [confirmTag,setConfirmTag]=useState<IviVorschlag|null>(null)

  const partnerFuer=(v:IviVorschlag)=>wahl[v.date]??(istPartner&&!canDirect?eigenerName:defaultPartner)

  async function uebernehmen(v:IviVorschlag){
    const person=partnerFuer(v)
    const code=(v.empfohlenerPartnerCode??'NM') as Code
    if(!person)return
    setBusy(v.date);setFehler(null)
    try{
      if(canDirect){
        onAssign(person,[v.date],code)
      }else{
        // Nicht-Admin: nur fuer sich selbst, als Anfrage (wie OpenDaysModal)
        if(!profile||person!==eigenerName){setFehler('Nur Admin/Geschäftsleitung dürfen andere eintragen.');return}
        await addDoc(collection(db,'planungRequests'),{
          type:'eintrag',uid:profile.uid,username:eigenerName,
          dates:[v.date],code,section:data.sections[0]?.label??'',
          status:'pending',createdAt:serverTimestamp(),
        })
        await writePlanEntry(eigenerName,[v.date],code,'warten auf Freigabe')
      }
    }catch(e){console.error(e);setFehler('Fehler beim Speichern.')}
    finally{setBusy(null);setConfirmTag(null)}
  }

  const fmtD=(s:string)=>`${s.slice(8,10)}.${s.slice(5,7)}.${s.slice(0,4)}`
  const fmtWd=(s:string)=>WEEKDAY_SHORT[new Date(s+'T12:00:00').getDay()]
  const offen=vorschlaege.filter(v=>v.status==='partner_fehlt').length
  // Oben die bereits stehenden IVI-Tage (siehe `geplant`), darunter die noch
  // offenen Moeglichkeiten — bereits geplante Tage dort nicht doppelt zeigen.
  const geplantDates=new Set(geplant.map(t=>t.date))
  const moegliche=vorschlaege.filter(v=>v.status!=='bereit'&&!geplantDates.has(v.date))

  return(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">IVI-Tage vorschlagen</h2>
            <p className="text-sm text-gray-500">
              {geplant.length} geplant · {moegliche.length} mögliche Tage{offen>0?` · ${offen} noch offen`:''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        {fehler&&<div className="mx-5 mt-3 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{fehler}</div>}

        <div className="overflow-y-auto p-5 space-y-2">
          {vorschlaege.length===0&&<p className="text-center text-gray-400 py-6">Keine Vorschläge — Einsatzplanung prüfen.</p>}

          {/* Geplante IVI-Tage — Darstellung wie die Dashboard-Kachel */}
          {geplant.length>0&&(
            <div className="rounded-xl border border-gray-200 overflow-hidden mb-3">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/70">
                <span className="text-sm font-semibold text-gray-800">Geplante IVI-Tage</span>
                <span className="ml-2 text-xs text-gray-400">{geplant.length}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {geplant.map(t=>(
                  <div key={t.date} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 w-6 shrink-0">{fmtWd(t.date)}</span>
                        <span className="text-sm text-gray-800">{fmtD(t.date)}</span>
                      </div>
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 shrink-0">KW {isoKalenderwoche(t.date)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 pl-8">
                      {t.anwesend.map(a=>(
                        <span key={a.name} className="flex items-center gap-1">
                          <span className="text-[11px] text-gray-600">{a.name}</span>
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${CODE_STYLE[a.code]??'bg-gray-100 text-gray-600'}`}>
                            {CODE_LABELS[a.code]??a.code}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {moegliche.length>0&&geplant.length>0&&(
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">Mögliche Tage</p>
          )}
          {moegliche.map(v=>{
            const st=VORSCHLAG_STYLE[v.status]
            const kannEintragen=v.status==='partner_fehlt'&&(canDirect||istPartner)
            return(
              <div key={v.rasterMontag} className={`rounded-xl border p-3 ${st.bg}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-gray-500 bg-white/80 border border-gray-200 rounded px-1.5 py-0.5">KW {v.kw}</span>
                      <span className="text-xs font-bold uppercase text-gray-400">{fmtWd(v.date)}</span>
                      <span className="text-sm font-bold text-gray-900">{fmtD(v.date)}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/70 text-gray-600">{st.label}</span>
                      {v.ausweich&&(
                        <span className="text-[10px] text-gray-500">
                          statt Mo {fmtD(v.rasterMontag)} — {v.ausweichGrund}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {v.anwesend.length===0
                        ?<span className="text-xs text-gray-400">niemand eingeteilt</span>
                        :v.anwesend.map(a=>(
                          <span key={a.name} className={`text-xs px-1.5 py-0.5 rounded ${a.injector?'bg-white text-gray-800 font-semibold':'bg-white/70 text-gray-600'}`}>
                            {a.name.split(' ').slice(-1)[0]} <span className="opacity-60">{a.code}</span>
                          </span>
                        ))}
                    </div>
                    {v.status==='halbtag_konflikt'&&(
                      <p className="text-[11px] text-blue-800 mt-1.5">
                        Beide sind da, treffen sich aber nicht — ein Halbtag müsste von VM auf NM
                        (oder umgekehrt) gewechselt werden. Das bitte von Hand entscheiden.
                      </p>
                    )}
                    {v.status==='kein_tag'&&v.geprueft.length>0&&(
                      <p className="text-[11px] text-gray-500 mt-1.5">
                        Geprüft: {v.geprueft.map(g=>`${fmtWd(g.date)} ${g.grund}`).join(' · ')}
                        {v.geprueft.length>1?' — keine Alternative in dieser Woche':''}
                      </p>
                    )}
                  </div>

                  {kannEintragen&&(
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canDirect
                        ?<select value={partnerFuer(v)} onChange={e=>setWahl(w=>({...w,[v.date]:e.target.value}))}
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white">
                          {partners.map(p=><option key={p} value={p}>{p.split(' ').slice(-1)[0]} ({einsaetze[p]??0})</option>)}
                        </select>
                        :<span className="text-xs text-gray-600">{eigenerName.split(' ').slice(-1)[0]}</span>}
                      <button onClick={()=>setConfirmTag(v)} disabled={busy===v.date}
                        className="px-2 py-1 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap">
                        {busy===v.date?'…':`als ${v.empfohlenerPartnerCode}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-500">
          Raster: jeder 2. Montag in <strong>ungeraden KW</strong> — bevorzugt Tage, an denen schon 2 Ärzte
          eingeteilt sind (egal VM/NM, Tschopp oder Trachsler). Ist nur Artemiev da, wird der Partner angefragt.
          Fällt der Montag aus, wird auf Do/Fr <strong>derselben</strong> Woche ausgewichen, nie in eine andere.
          Gerade KW sind manuelle Ausnahmen.
          {!canDirect&&istPartner&&<> Deine Einträge gehen als Anfrage zur Freigabe.</>}
        </div>
      </div>

      {confirmTag&&(
        <ConfirmDialog
          title="Tag eintragen?"
          danger={false}
          confirmLabel="Eintragen"
          isLoading={busy===confirmTag.date}
          message={
            `${fmtWd(confirmTag.date)} ${fmtD(confirmTag.date)}\n`
            +`${partnerFuer(confirmTag)} wird als «${confirmTag.empfohlenerPartnerCode}» eingetragen.\n\n`
            +(canDirect?'Der Eintrag wird direkt gespeichert.':'Der Eintrag geht als Anfrage zur Freigabe.')
          }
          onConfirm={()=>void uebernehmen(confirmTag)}
          onCancel={()=>setConfirmTag(null)}
        />
      )}
    </div>
  )
}

// ── Open days modal ───────────────────────────────────────────────────────────

interface EditRequest { id:string; dates?:string[]; code?:string; username?:string }

function OpenDaysModal({data,yearDays,onClose,onAssign,editRequest}:{
  data:PlanungData;yearDays:DayInfo[];onClose:()=>void
  onAssign:(person:string,days:string[],code:Code)=>void
  editRequest?:EditRequest
}){
  const { isAdmin, isGeschaeftsleitung, profile } = useAuth()
  const canDirectAssign = isAdmin || isGeschaeftsleitung
  const allPlanPersons0=data.sections.flatMap(s=>s.persons)
  const userName=(
    allPlanPersons0.find(p=>p===profile?.displayName)||
    allPlanPersons0.find(p=>p===profile?.username)||
    profile?.displayName||profile?.username||''
  )
  // For admin: pre-select own name if in planning, otherwise empty
  const adminDefault=editRequest?.username??(allPlanPersons0.includes(userName)?userName:'')
  const [docSel,setDocSel]=useState(adminDefault)
  const [selVm,setSelVm]=useState<Set<string>>(()=>new Set(editRequest?.code==='VM'?editRequest.dates??[]:[]))
  const [selNm,setSelNm]=useState<Set<string>>(()=>new Set(editRequest?.code==='NM'?editRequest.dates??[]:[]))
  const [selGt,setSelGt]=useState<Set<string>>(()=>new Set(editRequest?.code==='GT'?editRequest.dates??[]:[]))
  const [expanded,setExpanded]=useState<string|null>(null)
  const [submitting,setSubmitting]=useState(false)
  const [submitted,setSubmitted]=useState(false)
  const [submitError,setSubmitError]=useState<string|null>(null)
  const [filter,setFilter]=useState<'alle'|'kein_arzt'|'kapazitaet'>('alle')
  const aerzte=data.sections[0]
  const openHalfDays=getOpenHalfDays(data,yearDays)
  const keinArztDays=openHalfDays.filter(d=>d.totalCount===0&&d.day.key>=TODAY)
  const kapazitaetDays=openHalfDays.filter(d=>d.totalCount>0&&d.day.key>=TODAY)
  const filteredFutureDays=(filter==='kein_arzt'?keinArztDays:filter==='kapazitaet'?kapazitaetDays:openHalfDays.filter(d=>d.day.key>=TODAY))
  const byMonth:Record<number,OpenHalfDay[]>={}
  for(const d of filteredFutureDays){if(!byMonth[d.day.monthIdx])byMonth[d.day.monthIdx]=[];byMonth[d.day.monthIdx].push(d)}
  const halfDayMap=new Map(openHalfDays.map(d=>[d.day.key,d]))
  const countHD=(arr:OpenHalfDay[])=>arr.reduce((s,d)=>s+(d.vmOpen?0.5:0)+(d.nmOpen?0.5:0),0)
  const overbookedVm=new Set([...selVm].filter(key=>{const d=halfDayMap.get(key);return d?d.vmCount>=2:false}))
  const overbookedNm=new Set([...selNm].filter(key=>{const d=halfDayMap.get(key);return d?d.nmCount>=2:false}))
  const overbookedGt=new Set([...selGt].filter(key=>{const d=halfDayMap.get(key);return d?(d.vmCount>=2||d.nmCount>=2):false}))
  const validVmKeys=[...selVm].filter(k=>!overbookedVm.has(k))
  const validNmKeys=[...selNm].filter(k=>!overbookedNm.has(k))
  const validGtKeys=[...selGt].filter(k=>!overbookedGt.has(k))
  const totalOverbooked=overbookedVm.size+overbookedNm.size+overbookedGt.size
  const selDayCount=(validVmKeys.length+validNmKeys.length)*0.5+validGtKeys.length

  // toggle helpers — selecting GT clears VM+NM for that day; selecting VM/NM clears GT
  const toggleVm=(key:string)=>{
    setSelGt(prev=>{const n=new Set(prev);n.delete(key);return n})
    setSelVm(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n})
  }
  const toggleNm=(key:string)=>{
    setSelGt(prev=>{const n=new Set(prev);n.delete(key);return n})
    setSelNm(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n})
  }
  const toggleGt=(key:string)=>{
    setSelVm(prev=>{const n=new Set(prev);n.delete(key);return n})
    setSelNm(prev=>{const n=new Set(prev);n.delete(key);return n})
    setSelGt(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n})
  }
  const toggleMonth=(halfDays:OpenHalfDay[])=>{
    const gtKeys=halfDays.filter(d=>d.vmOpen&&d.nmOpen&&d.day.key>=TODAY).map(d=>d.day.key)
    const vmKeys=halfDays.filter(d=>d.vmOpen&&!d.nmOpen&&d.day.key>=TODAY).map(d=>d.day.key)
    const nmKeys=halfDays.filter(d=>d.nmOpen&&!d.vmOpen&&d.day.key>=TODAY).map(d=>d.day.key)
    const allSel=gtKeys.every(k=>selGt.has(k))&&vmKeys.every(k=>selVm.has(k))&&nmKeys.every(k=>selNm.has(k))
    setSelGt(prev=>{const n=new Set(prev);allSel?gtKeys.forEach(k=>n.delete(k)):gtKeys.forEach(k=>n.add(k));return n})
    setSelVm(prev=>{const n=new Set(prev);allSel?vmKeys.forEach(k=>n.delete(k)):vmKeys.forEach(k=>n.add(k));return n})
    setSelNm(prev=>{const n=new Set(prev);allSel?nmKeys.forEach(k=>n.delete(k)):nmKeys.forEach(k=>n.add(k));return n})
  }

  // Admin/GL mode: directly assign
  const assignTarget = isAdmin ? docSel : userName
  const handleAssign=()=>{
    if(!assignTarget||(validVmKeys.length===0&&validNmKeys.length===0&&validGtKeys.length===0))return
    if(validGtKeys.length>0)onAssign(assignTarget,validGtKeys,'GT')
    if(validVmKeys.length>0)onAssign(assignTarget,validVmKeys,'VM')
    if(validNmKeys.length>0)onAssign(assignTarget,validNmKeys,'NM')
    onClose()
  }

  // Non-admin mode: create or update a planungRequest in Firestore
  const handleEintragen=async()=>{
    if(!profile||(validVmKeys.length===0&&validNmKeys.length===0&&validGtKeys.length===0))return
    if(!userName){setSubmitError('Benutzerprofil nicht erkannt – bitte Administrator kontaktieren.');return}
    setSubmitting(true)
    try{
      if(editRequest){
        // Edit mode: remove old plan entries, write new ones
        const newDates=validGtKeys.length>0?validGtKeys:validVmKeys.length>0?validVmKeys:validNmKeys
        const newCode=validGtKeys.length>0?'GT':validVmKeys.length>0?'VM':'NM'
        if(editRequest.dates&&editRequest.username) await removePlanEntry(editRequest.username,editRequest.dates)
        await writePlanEntry(userName,newDates,newCode,'warten auf Freigabe')
        await updateDoc(doc(db,'planungRequests',editRequest.id),{
          dates:newDates,code:newCode,status:'pending',
          adminNote:deleteField(),actionBy:deleteField(),actionAt:deleteField()
        })
      }else{
        if(validGtKeys.length>0){
          await addDoc(collection(db,'planungRequests'),{
            type:'eintrag',uid:profile.uid,username:userName,
            dates:validGtKeys,code:'GT',section:aerzte.label,status:'pending',createdAt:serverTimestamp(),
          })
          await writePlanEntry(userName,validGtKeys,'GT','warten auf Freigabe')
        }
        if(validVmKeys.length>0){
          await addDoc(collection(db,'planungRequests'),{
            type:'eintrag',uid:profile.uid,username:userName,
            dates:validVmKeys,code:'VM',section:aerzte.label,status:'pending',createdAt:serverTimestamp(),
          })
          await writePlanEntry(userName,validVmKeys,'VM','warten auf Freigabe')
        }
        if(validNmKeys.length>0){
          await addDoc(collection(db,'planungRequests'),{
            type:'eintrag',uid:profile.uid,username:userName,
            dates:validNmKeys,code:'NM',section:aerzte.label,status:'pending',createdAt:serverTimestamp(),
          })
          await writePlanEntry(userName,validNmKeys,'NM','warten auf Freigabe')
        }
      }
      setSubmitted(true)
      setTimeout(onClose,1500)
    }catch(e){console.error(e);setSubmitError('Fehler beim Speichern. Bitte erneut versuchen.')}finally{setSubmitting(false)}
  }

  if(submitted){
    return(
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-3">
          <div className="text-4xl">✅</div>
          <p className="text-lg font-semibold text-gray-800">{editRequest?'Antrag aktualisiert!':'Antrag eingereicht!'}</p>
          <p className="text-sm text-gray-500">Der Administrator wird benachrichtigt.</p>
        </div>
      </div>
    )
  }

  return(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Offene Tage</h2>
            <p className="text-sm text-gray-500">{countHD(filteredFutureDays)} offene Slots</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap bg-gray-50/60">
          {isAdmin?(
            <select value={docSel} onChange={e=>setDocSel(e.target.value)} className="input text-sm py-1.5 h-9 flex-1 min-w-[180px]">
              <option value="">— Person auswählen —</option>
              {data.sections.map(s=>(
                <optgroup key={s.label} label={s.label}>
                  {s.persons.map(p=><option key={p} value={p}>{p}</option>)}
                </optgroup>
              ))}
            </select>
          ):userName?(
            <div className="flex items-center gap-2 px-3 h-9 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 shrink-0">
              <User className="w-3.5 h-3.5 text-gray-400 shrink-0"/>
              <span className="font-medium">{userName}</span>
            </div>
          ):null}
          {(selVm.size>0||selNm.size>0||selGt.size>0)&&(
            <button onClick={()=>{setSelVm(new Set());setSelNm(new Set());setSelGt(new Set())}} className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-auto">Auswahl löschen</button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="px-6 py-2 border-b border-gray-100 flex items-center gap-1.5">
          {([
            {key:'alle',       label:'Alle',                count:openHalfDays.filter(d=>d.day.key>=TODAY).length},
            {key:'kein_arzt',  label:'⚠ Kein Arzt',        count:keinArztDays.length},
            {key:'kapazitaet', label:'＋ Freie Kapazität',  count:kapazitaetDays.length},
          ] as const).map(({key,label,count})=>(
            <button key={key} onClick={()=>setFilter(key)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors border
                ${filter===key?'bg-gray-800 text-white border-gray-800':'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'}`}>
              {label} <span className={`ml-0.5 ${filter===key?'text-gray-300':'text-gray-400'}`}>({count})</span>
            </button>
          ))}
        </div>

        {/* Capacity warning */}
        {totalOverbooked>0&&(
          <div className="px-6 py-2.5 bg-red-50 border-b border-red-200 flex items-start gap-2 text-xs text-red-700">
            <span className="shrink-0 font-bold mt-px">⚠</span>
            <span>
              {totalOverbooked} {totalOverbooked===1?'Slot ist':'Slots sind'} bereits besetzt und {totalOverbooked===1?'wird':'werden'} übersprungen.
              {(validVmKeys.length+validNmKeys.length)>0
                ? ` Nur ${selDayCount} ${selDayCount===1?'Tag wird':'Tage werden'} eingeteilt.`
                : ' Keine gültige Auswahl.'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {filteredFutureDays.length===0&&openHalfDays.filter(d=>d.day.key>=TODAY).length>0&&<p className="text-center text-gray-400 py-8">Keine Einträge in dieser Ansicht.</p>}
          {openHalfDays.filter(d=>d.day.key>=TODAY).length===0&&<p className="text-center text-gray-400 py-8">Alle Werktage sind besetzt 🎉</p>}
          {Object.entries(byMonth).map(([mi,halfDays])=>{
            const allSel=halfDays.length>0&&halfDays.every(d=>{
              if(d.vmOpen&&d.nmOpen)return selGt.has(d.day.key)||(selVm.has(d.day.key)&&selNm.has(d.day.key))
              if(d.vmOpen)return selVm.has(d.day.key)||selGt.has(d.day.key)
              if(d.nmOpen)return selNm.has(d.day.key)||selGt.has(d.day.key)
              return true
            })
            const someSel=halfDays.some(d=>selVm.has(d.day.key)||selNm.has(d.day.key)||selGt.has(d.day.key))
            return(
              <div key={mi}>
                <button onClick={()=>toggleMonth(halfDays)}
                  className="flex items-center gap-2 mb-2 group">
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                    ${allSel?'bg-primary-600 border-primary-600':someSel?'bg-primary-200 border-primary-400':'border-gray-300 group-hover:border-primary-400'}`}>
                    {allSel&&<span className="text-white text-[9px] font-bold">✓</span>}
                    {someSel&&!allSel&&<span className="text-primary-700 text-[9px] font-bold">–</span>}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 group-hover:text-primary-600 transition-colors">
                    {MONTHS[Number(mi)]} ({countHD(halfDays)})
                  </span>
                </button>
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {halfDays.map(({day,vmOpen,nmOpen})=>{
                    const vmSel=selVm.has(day.key)
                    const nmSel=selNm.has(day.key)
                    const gtSel=selGt.has(day.key)
                    const isSel=vmSel||nmSel||gtSel
                    const isExp=expanded===day.key
                    const gtDisabled=vmSel||nmSel
                    const halfDisabled=gtSel
                    return(
                      <div key={day.key} className="flex flex-col">
                        <button
                          onClick={()=>setExpanded(isExp?null:day.key)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border
                            ${isExp?'bg-gray-100 border-gray-300 text-gray-800'
                            :isSel?'bg-primary-50 border-primary-300 text-primary-700'
                            :'bg-white border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'}`}>
                          {WEEKDAY_SHORT[day.dow]} {day.d}.
                          {gtSel&&<span className={`text-[9px] px-1 py-px rounded font-bold ${CODE_STYLE['GT']}`}>GT</span>}
                          {vmSel&&<span className={`text-[9px] px-1 py-px rounded font-bold ${CODE_STYLE['VM']}`}>VM</span>}
                          {nmSel&&<span className={`text-[9px] px-1 py-px rounded font-bold ${CODE_STYLE['NM']}`}>NM</span>}
                        </button>
                        {isExp&&(
                          <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1 px-1 py-2 bg-gray-50 rounded-xl border border-gray-200">
                            {vmOpen&&nmOpen&&(
                              <button onClick={()=>toggleGt(day.key)} disabled={gtDisabled}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all
                                  ${gtSel?'border-green-400 bg-green-50 ring-2 ring-green-300'
                                  :gtDisabled?'border-gray-200 bg-gray-100 opacity-40 cursor-not-allowed'
                                  :'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50'}`}>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${CODE_STYLE['GT']}`}>GT</span>
                                <span className="text-gray-700">Ganztag</span>
                              </button>
                            )}
                            {vmOpen&&(
                              <button onClick={()=>toggleVm(day.key)} disabled={halfDisabled}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all
                                  ${vmSel?'border-blue-400 bg-blue-50 ring-2 ring-blue-300'
                                  :halfDisabled?'border-gray-200 bg-gray-100 opacity-40 cursor-not-allowed'
                                  :'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'}`}>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${CODE_STYLE['VM']}`}>VM</span>
                                <span className="text-gray-700">Vormittag</span>
                              </button>
                            )}
                            {nmOpen&&(
                              <button onClick={()=>toggleNm(day.key)} disabled={halfDisabled}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all
                                  ${nmSel?'border-yellow-400 bg-yellow-50 ring-2 ring-yellow-300'
                                  :halfDisabled?'border-gray-200 bg-gray-100 opacity-40 cursor-not-allowed'
                                  :'border-gray-200 bg-white hover:border-yellow-300 hover:bg-yellow-50'}`}>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${CODE_STYLE['NM']}`}>NM</span>
                                <span className="text-gray-700">Nachmittag</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {submitError&&(
          <div className="px-6 py-2 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/60">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{selDayCount} Tage ausgewählt</span>
            {editRequest&&(
              <button onClick={async()=>{
                  await updateDoc(doc(db,'planungRequests',editRequest.id),{status:'withdrawn'})
                  onClose()
                }}
                className="px-3 py-1.5 text-sm text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium">
                Antrag zurückziehen
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Abbrechen</button>
            {canDirectAssign?(
              <button onClick={handleAssign} disabled={!assignTarget||(validVmKeys.length===0&&validNmKeys.length===0&&validGtKeys.length===0)}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                {isAdmin?`Zuweisen (${selDayCount})`:`Eintragen (${selDayCount})`}
              </button>
            ):(
              <button onClick={handleEintragen} disabled={(validVmKeys.length===0&&validNmKeys.length===0&&validGtKeys.length===0)||submitting}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                {submitting?'Wird gespeichert…':editRequest?`Aktualisieren (${selDayCount})`:`Eintragen (${selDayCount})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Liris Blocker Modal ───────────────────────────────────────────────────────

function TimeInput({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){
  return(
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <input type="time" value={value} onChange={e=>onChange(e.target.value)}
        className="input text-xs py-1 h-8 w-24"/>
    </label>
  )
}

function HoursConfig({person,wh,onChange}:{person:string;wh:WorkHoursStore;onChange:(wh:WorkHoursStore)=>void}){
  const h=getHours(person,wh)
  const set=(k:keyof PersonHours,v:string)=>{const nw={...wh,[person]:{...h,[k]:v}};onChange(nw);saveWorkHoursFirestore(nw)}
  return(
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="text-xs font-bold text-gray-700">Arbeitszeiten für {person}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Verfügbar (min–max)</div>
          <div className="flex gap-2 flex-wrap">
            <TimeInput label="Von" value={h.dayStart} onChange={v=>set('dayStart',v)}/>
            <TimeInput label="Bis" value={h.dayEnd} onChange={v=>set('dayEnd',v)}/>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Mittagspause</div>
          <div className="flex gap-2 flex-wrap">
            <TimeInput label="Von" value={h.lunchStart} onChange={v=>set('lunchStart',v)}/>
            <TimeInput label="Bis" value={h.lunchEnd} onChange={v=>set('lunchEnd',v)}/>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Vormittag (VM) endet um</div>
          <TimeInput label="Ende VM" value={h.vmEnd} onChange={v=>set('vmEnd',v)}/>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-gray-500 mb-1.5">Nachmittag (NM) beginnt um</div>
          <TimeInput label="Start NM" value={h.nmStart} onChange={v=>set('nmStart',v)}/>
        </div>
      </div>
    </div>
  )
}

function LirisModal({data,yearDays,year,feiertage,onClose}:{
  data:PlanungData;yearDays:DayInfo[];year:number;feiertage:Record<string,string>;onClose:()=>void
}){
  const allPersons=data.sections.flatMap(s=>s.persons)
  const toast = useToast()
  const [person,setPerson]=useState(allPersons[0]??'')
  const [fromMonth,setFromMonth]=useState(new Date().getMonth())
  const [toMonth,setToMonth]=useState(new Date().getMonth())
  const [wh,setWh]=useState<WorkHoursStore>({})
  const [showConfig,setShowConfig]=useState(false)
  useEffect(()=>{loadWorkHoursFirestore().then(setWh).catch(()=>{})},[])

  const filteredDays=yearDays.filter(d=>d.monthIdx>=fromMonth&&d.monthIdx<=toMonth)
  const blockers=person?calcBlockers(person,filteredDays,data.schedule,wh,feiertage):[]

  const byMonth:Record<number,Blocker[]>={}
  for(const b of blockers){
    const mi=new Date(b.date).getMonth()
    if(!byMonth[mi])byMonth[mi]=[]
    byMonth[mi].push(b)
  }

  const buildIcsContent=()=>{
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN',
      `PRODID:-//Augenzentrum Suhr//Liris Blocker ${person}//DE`,
      `X-WR-CALNAME:Blocker ${person}`,
      `X-WR-CALDESC:Liris-Sperrzeiten für ${person}`,
      'METHOD:PUBLISH']
    for(const b of blockers){
      const d=b.date.replace(/-/g,'')
      const uid=`${d}-${b.start.replace(':','')}-${person.replace(/\s/g,'')}@augenzentrum-suhr`
      lines.push('BEGIN:VEVENT',
        `UID:${uid}`,`DTSTART:${d}T${b.start.replace(':','')}00`,
        `DTEND:${d}T${b.end.replace(':','')}00`,
        `SUMMARY:${person} – Blocker (${b.reason})`,
        `DESCRIPTION:Arzt/MPA: ${person}\\nGrund: ${b.reason}\\nZeit: ${b.start}–${b.end}`,
        `LOCATION:Augenzentrum Suhr`,
        `TRANSP:OPAQUE`,'END:VEVENT')
    }
    lines.push('END:VCALENDAR')
    return lines.join('\r\n')
  }

  const icsFilename=`liris-blocker-${person.split(' ')[0]}-${MONTHS_SHORT[fromMonth]}-${year}.ics`

  const downloadIcs=()=>{
    const content=buildIcsContent()
    const blob=new Blob([content],{type:'text/calendar'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a');a.href=url;a.download=icsFilename
    a.click();URL.revokeObjectURL(url)
  }

  const openInOutlook=async()=>{
    const content=buildIcsContent()
    const api=(window as any).electronApp
    if(api?.openIcs){
      const res=await api.openIcs(content,icsFilename)
      if(!res?.ok)toast.error('Fehler: '+res?.error)
    } else { downloadIcs() }
  }

  return(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">L</span>
              Liris Blocker
            </h2>
            <p className="text-sm text-gray-500">Sperrzeiten für vip.liris.ch berechnen und exportieren</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex items-end gap-4 flex-wrap bg-gray-50/60">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Arzt / MPA</span>
            <select value={person} onChange={e=>setPerson(e.target.value)} className="input text-sm py-1.5 h-9 min-w-[180px]">
              {data.sections.map(s=>(
                <optgroup key={s.label} label={s.label}>
                  {s.persons.map(p=><option key={p} value={p}>{p}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Von Monat</span>
            <select value={fromMonth} onChange={e=>{const v=Number(e.target.value);setFromMonth(v);if(toMonth<v)setToMonth(v)}} className="input text-sm py-1.5 h-9">
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Bis Monat</span>
            <select value={toMonth} onChange={e=>setToMonth(Number(e.target.value))} className="input text-sm py-1.5 h-9">
              {MONTHS.map((m,i)=><option key={i} value={i} disabled={i<fromMonth}>{m}</option>)}
            </select>
          </label>
          <button onClick={()=>setShowConfig(v=>!v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors h-9 self-end
              ${showConfig?'bg-primary-50 border-primary-300 text-primary-700':'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            ⚙️ Arbeitszeiten
          </button>
        </div>

        {showConfig&&person&&(
          <div className="px-6 py-4 border-b border-gray-100">
            <HoursConfig person={person} wh={wh} onChange={setWh}/>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {blockers.length===0&&(
            <div className="text-center py-10 text-gray-400">
              <div className="text-4xl mb-2">🎉</div>
              <p>Keine Blocker notwendig – alle Arbeitstage sind geplant.</p>
            </div>
          )}
          {Object.entries(byMonth).map(([mi,bs])=>(
            <div key={mi}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-2">
                {MONTHS[Number(mi)]} {year} <span className="text-gray-300">·</span> {bs.length} Blocker
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-[10px]">
                    <th className="text-left px-2 py-1.5 rounded-l font-semibold w-28">Datum</th>
                    <th className="text-left px-2 py-1.5 font-semibold w-16">Von</th>
                    <th className="text-left px-2 py-1.5 font-semibold w-16">Bis</th>
                    <th className="text-left px-2 py-1.5 rounded-r font-semibold">Grund</th>
                  </tr>
                </thead>
                <tbody>
                  {bs.map((b,i)=>{
                    const d=new Date(b.date)
                    const dow=d.getDay()
                    const isFullDay=b.start===getHours(person,wh).dayStart&&b.end===getHours(person,wh).dayEnd
                    return(
                      <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors">
                        <td className="px-2 py-1 font-medium text-gray-700">
                          {WEEKDAY_SHORT[dow]} {String(d.getDate()).padStart(2,'0')}.{String(d.getMonth()+1).padStart(2,'0')}.
                        </td>
                        <td className="px-2 py-1 font-mono text-blue-700">{b.start}</td>
                        <td className="px-2 py-1 font-mono text-blue-700">{b.end}</td>
                        <td className="px-2 py-1 text-gray-500">
                          {isFullDay
                            ?<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">Ganztag</span>
                            :b.reason==='Mittagspause'
                              ?<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-semibold">Mittag</span>
                              :<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold">{b.reason}</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/60 flex-wrap gap-2">
          <span className="text-sm text-gray-500">{blockers.length} Blocker berechnet</span>
          <div className="flex gap-2 flex-wrap">
            <button onClick={()=>window.open('https://vip.liris.ch','_blank')}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium">
              🌐 Liris öffnen
            </button>
            <button onClick={downloadIcs} disabled={blockers.length===0}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 rounded-lg transition-colors font-medium disabled:opacity-40">
              ⬇ .ics speichern
            </button>
            <button onClick={openInOutlook} disabled={blockers.length===0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium">
              📅 In Outlook öffnen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Table component (shared for month + year view) ────────────────────────────

interface PlanTableProps {
  days: DayInfo[]
  data: PlanungData
  showMonthSep?: boolean
  hoveredPerson: string|null
  hoveredCol: string|null
  setHoveredPerson: (p:string|null)=>void
  setHoveredCol: (k:string|null)=>void
  onCellClick: (e:React.MouseEvent,person:string,date:string)=>void
  onCellDoubleClick?: (e:React.MouseEvent,person:string,date:string)=>void
  comments?: Record<string, Record<string, string>>
  onPersonClick: (person:string)=>void
  onRemovePerson: (section:string,person:string)=>void
  onRenamePerson: (section:string,oldName:string,newName:string)=>void
  userNames: string[]
  addingTo: string|null
  setAddingTo: (s:string|null)=>void
  newName: string
  setNewName: (s:string)=>void
  onAddPerson: (section:string)=>void
  multiSel?: Set<string>
  onCellMouseDown?: (person:string,date:string)=>void
  onCellMouseEnter?: (person:string,date:string)=>void
  isAdmin?: boolean
  isGeschaeftsleitung?: boolean
  onSetPensum?: (person:string,val:number|null)=>void
  onToggleInactive?: (person:string)=>void
  onReorderPersons?: (section:string,persons:string[])=>void
}

function PlanTable({days,data,showMonthSep,hoveredPerson,hoveredCol,setHoveredPerson,setHoveredCol,onCellClick,onCellDoubleClick,onPersonClick,onRemovePerson,onRenamePerson,userNames,addingTo,setAddingTo,newName,setNewName,onAddPerson,multiSel,onCellMouseDown,onCellMouseEnter,isAdmin,isGeschaeftsleitung,comments,onSetPensum,onToggleInactive,onReorderPersons}:PlanTableProps){
  const [editingPerson,setEditingPerson]=useState<{section:string;person:string;value:string}|null>(null)
  const [editingPensum,setEditingPensum]=useState<{person:string;value:string}|null>(null)
  const [dragState,setDragState]=useState<{person:string;section:string}|null>(null)
  const [dragOver,setDragOver]=useState<string|null>(null)
  const touchDragPersonRef=useRef<string|null>(null)
  const touchDragOverRef=useRef<string|null>(null)
  const canDrag=!!(isAdmin||isGeschaeftsleitung)
  const showPensum=!!(isAdmin||isGeschaeftsleitung)
  const inactiveSet=new Set(data.inactive??[])

  // Compute assigned days in visible range (GT=1, VM=0.5, NM=0.5)
  const totalWorkdays=days.filter(d=>!d.isWeekend&&!d.ftName).length
  const assignedDays=(person:string)=>{
    const ps=data.schedule[person]??{}
    return days.reduce((acc,{key,isWeekend,ftName})=>{
      if(isWeekend||ftName)return acc
      const c=ps[key]
      if(!c)return acc
      if(c==='GT')return acc+1
      if(c==='VM'||c==='NM')return acc+0.5
      return acc
    },0)
  }

  return(
    <table className="text-xs border-collapse min-w-full">
      <thead className="sticky top-0 z-20">
        <tr className="bg-gray-50 border-b border-gray-200">
          <th className="sticky left-0 z-30 bg-gray-50 px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap border-r border-gray-200">Person</th>
          {showPensum&&<th className="sticky top-0 bg-gray-50 px-2 py-2 text-center font-medium text-gray-500 whitespace-nowrap border-r border-gray-200 w-14">%</th>}
          {showPensum&&<th className="sticky top-0 bg-gray-50 px-2 py-2 text-center font-medium text-gray-500 whitespace-nowrap border-r border-gray-200 w-16">Tage</th>}
          {days.map(({d,dow,isWeekend,ftName,key,monthIdx,isCurrentMonth},i)=>{
            const isMonthStart=showMonthSep&&d===1&&isCurrentMonth
            const isHovCol=hoveredCol===key
            const isToday=key===TODAY
            const isOutOfMonth=!isCurrentMonth
            const isMonday=dow===1
            const showKW=isMonday||(i===0&&dow!==0)
            return(
              <th key={`${key}`}
                onMouseEnter={()=>setHoveredCol(key)}
                onMouseLeave={()=>setHoveredCol(null)}
                title={ftName?`KW ${getKW(key)} · ${ftName}`:`KW ${getKW(key)}`}
                className={`py-1 text-center font-medium border-r border-gray-100 transition-colors opacity-${isOutOfMonth?'50':'100'}
                  ${isMonthStart?'border-l-2 border-l-gray-400':''}
                  ${isToday?'bg-primary-600 text-white':isHovCol?'bg-primary-100 text-primary-700':ftName?'bg-orange-100 text-orange-700':isOutOfMonth?'bg-gray-50 text-gray-300':isWeekend?'bg-gray-100 text-gray-400':'text-gray-500'}
                  ${showMonthSep?'w-7':'w-9'}`}>
                {showKW&&<div className={`text-[7px] font-bold leading-none mb-0.5 ${isToday?'text-primary-200':'text-primary-500'}`}>KW{getKW(key)}</div>}
                {isMonthStart&&!showKW&&<div className="text-[8px] font-bold leading-none opacity-80">{MONTHS_SHORT[monthIdx]}</div>}
                {isMonthStart&&showKW&&<div className="text-[7px] font-bold leading-none opacity-80">{MONTHS_SHORT[monthIdx]}</div>}
                <div className="leading-none text-[10px] font-bold">{d}</div>
                <div className={`text-[9px] font-normal leading-none mt-0.5 ${isToday?'text-primary-200':isHovCol?'text-primary-600':'text-gray-400'}`}>{WEEKDAY_SHORT[dow]}</div>
                {ftName&&!isToday&&<div className="text-[8px] font-semibold leading-none mt-0.5 text-orange-600">{FT_SHORT[ftName]??ftName.slice(0,3)}</div>}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {data.sections.map(section=>(
          <>
            <tr key={section.label} className="bg-gray-100">
              {section.label==='Mitarbeiter SU'?(
                <>
                  <td className="sticky left-0 z-10 bg-gray-100 px-3 py-1.5 font-semibold text-gray-700 text-xs uppercase tracking-wide border-b border-gray-200 whitespace-nowrap">{section.label}</td>
                  {showPensum&&<td className="border-r border-gray-100 border-b border-gray-200 bg-gray-100"/>}
                  {showPensum&&<td className="border-r border-gray-100 border-b border-gray-200 bg-gray-100"/>}
                  {days.map(({key,isWeekend,ftName,d,isCurrentMonth})=>{
                    const isMonthStart=showMonthSep&&d===1&&isCurrentMonth
                    const baseClass=`py-1 text-center border-r border-gray-100 border-b border-gray-200 bg-gray-100 opacity-${isCurrentMonth?'100':'50'}${isMonthStart?' border-l-2 border-l-gray-400':''}`
                    if(isWeekend||ftName) return <td key={key} className={baseClass}/>
                    const arzteSection=data.sections[0]
                    const workingAerzte=(arzteSection?.persons??[]).filter(p=>!inactiveSet.has(p)&&(()=>{const c=data.schedule[p]?.[key];return!!(c&&CLINIC_CODES.has(c))})())
                    const kirrPresent=workingAerzte.some(p=>p.includes(KIRR_NAME))
                    const doctorFTE=workingAerzte.reduce((s,p)=>{const c=data.schedule[p]?.[key];return s+(c==='GT'?1:0.5)},0)
                    const required=kirrPresent?4:doctorFTE>=2?3:workingAerzte.length===0?1:2
                    const actual=section.persons.filter(p=>!inactiveSet.has(p)&&(()=>{const c=data.schedule[p]?.[key];return!!(c&&CLINIC_CODES.has(c))})()).length
                    const met=actual>=required
                    return(
                      <td key={key} className={baseClass}>
                        <span className={`text-[9px] font-bold leading-none ${met?'text-green-600':'text-red-500'}`}>{actual}/{required}</span>
                      </td>
                    )
                  })}
                </>
              ):(
                <td colSpan={days.length+1+(showPensum?2:0)} className="px-3 py-1.5 font-semibold text-gray-700 text-xs uppercase tracking-wide border-b border-gray-200">{section.label}</td>
              )}
            </tr>
            {section.persons.map((person,pi)=>{
              const ps=data.schedule[person]??{}
              const isHovRow=hoveredPerson===person
              const isInactive=inactiveSet.has(person)
              const isDragging=dragState?.person===person
              const isDragOver=dragOver===person&&dragState?.person!==person&&dragState?.section===section.label
              return(
                <tr key={person}
                  data-person={person}
                  data-section={section.label}
                  draggable={canDrag}
                  style={canDrag?{touchAction:'none'}:undefined}
                  onDragStart={canDrag?e=>{e.dataTransfer.effectAllowed='move';setDragState({person,section:section.label})}:undefined}
                  onDragOver={canDrag?e=>{e.preventDefault();e.dataTransfer.dropEffect='move';setDragOver(person)}:undefined}
                  onDragLeave={canDrag?()=>setDragOver(null):undefined}
                  onDrop={canDrag?e=>{
                    e.preventDefault();setDragOver(null)
                    if(!dragState||dragState.section!==section.label||dragState.person===person)return
                    const persons=[...section.persons]
                    const fromIdx=persons.indexOf(dragState.person)
                    const toIdx=persons.indexOf(person)
                    if(fromIdx<0||toIdx<0)return
                    persons.splice(fromIdx,1);persons.splice(toIdx,0,dragState.person)
                    onReorderPersons?.(section.label,persons)
                    setDragState(null)
                  }:undefined}
                  onDragEnd={canDrag?()=>{setDragState(null);setDragOver(null)}:undefined}
                  onTouchStart={canDrag?()=>{
                    touchDragPersonRef.current=person
                    touchDragOverRef.current=null
                    setDragState({person,section:section.label})
                  }:undefined}
                  onTouchMove={canDrag?e=>{
                    const touch=e.touches[0]
                    const el=document.elementFromPoint(touch.clientX,touch.clientY)
                    const row=el?.closest('[data-person]') as HTMLElement|null
                    const over=row?.dataset.person
                    const overSec=row?.dataset.section
                    if(over&&overSec===section.label&&over!==person){
                      touchDragOverRef.current=over
                      setDragOver(over)
                    }
                  }:undefined}
                  onTouchEnd={canDrag?()=>{
                    const from=touchDragPersonRef.current
                    const to=touchDragOverRef.current
                    if(from&&to&&from!==to){
                      const persons=[...section.persons]
                      const fromIdx=persons.indexOf(from)
                      const toIdx=persons.indexOf(to)
                      if(fromIdx>=0&&toIdx>=0){
                        persons.splice(fromIdx,1)
                        persons.splice(toIdx,0,from)
                        onReorderPersons?.(section.label,persons)
                      }
                    }
                    touchDragPersonRef.current=null
                    touchDragOverRef.current=null
                    setDragState(null)
                    setDragOver(null)
                  }:undefined}
                  onMouseEnter={()=>setHoveredPerson(person)}
                  onMouseLeave={()=>{setHoveredPerson(null);setHoveredCol(null)}}
                  className={`border-b transition-colors group
                    ${isDragging?'opacity-40 border-gray-100':''}
                    ${isDragOver?'border-t-2 border-t-primary-400 border-b-gray-100':'border-b-gray-100'}
                    ${!isDragging&&!isDragOver?(isInactive?'opacity-40 ':'')+(isHovRow?'bg-primary-50/60':pi%2===0?'bg-white':'bg-gray-50/50'):''}
                    ${canDrag?'cursor-grab active:cursor-grabbing':''}`}>
                  <td className={`sticky left-0 z-10 px-3 py-1 font-medium border-r border-gray-200 whitespace-nowrap transition-colors ${isInactive?'text-gray-400':'text-gray-700'} ${isHovRow?'bg-primary-100':'bg-inherit'}`}>
                    <div className="flex items-center gap-1">
                    {canDrag&&<GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"/>}
                    {editingPerson?.section===section.label&&editingPerson?.person===person?(
                      <div className="flex items-center gap-1 min-w-[120px]">
                        <select autoFocus value={editingPerson.value}
                          onChange={e=>setEditingPerson(ep=>ep?{...ep,value:e.target.value}:ep)}
                          className="flex-1 text-xs border border-primary-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500">
                          <option value="">— Name wählen —</option>
                          {userNames.map(n=><option key={n} value={n}>{n}</option>)}
                        </select>
                        <button onClick={()=>{if(editingPerson.value&&editingPerson.value!==person)onRenamePerson(section.label,person,editingPerson.value);setEditingPerson(null)}}
                          className="p-0.5 rounded text-green-600 hover:bg-green-50" title="Speichern">
                          <Check className="w-3 h-3"/>
                        </button>
                        <button onClick={()=>setEditingPerson(null)}
                          className="p-0.5 rounded text-gray-400 hover:bg-gray-100" title="Abbrechen">
                          <X className="w-3 h-3"/>
                        </button>
                      </div>
                    ):(
                      <div className="flex items-center justify-between gap-1">
                        <span className={`cursor-pointer hover:text-primary-600 transition-colors ${isInactive?'line-through':''}`} onClick={()=>onPersonClick(person)}>{person}</span>
                        {isAdmin&&(
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={()=>onToggleInactive?.(person)}
                              className={`p-0.5 rounded transition-colors ${isInactive?'text-amber-400 hover:text-amber-600':'text-gray-300 hover:text-amber-500'}`}
                              title={isInactive?'Reaktivieren':'Deaktivieren'}>
                              <UserX className="w-3 h-3"/>
                            </button>
                            <button onClick={()=>setEditingPerson({section:section.label,person,value:person})}
                              className="p-0.5 rounded text-gray-300 hover:text-primary-500" title="Umbenennen">
                              <Pencil className="w-3 h-3"/>
                            </button>
                            <button onClick={()=>onRemovePerson(section.label,person)}
                              className="p-0.5 rounded text-gray-300 hover:text-red-500" title="Entfernen">
                              <Trash2 className="w-3 h-3"/>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  </td>
                  {/* Pensum % */}
                  {showPensum&&(()=>{
                    const pensumVal=data.pensum?.[person]
                    const isEditing=editingPensum?.person===person
                    return(
                      <td className={`text-center border-r border-gray-100 py-1 px-1 w-14 ${isHovRow?'bg-primary-50/60':pi%2===0?'bg-white':'bg-gray-50/50'}`}>
                        {isEditing?(
                          <input autoFocus type="number" min={0} max={100} value={editingPensum!.value}
                            onChange={e=>setEditingPensum(ep=>ep?{...ep,value:e.target.value}:ep)}
                            onBlur={()=>{onSetPensum?.(person,parseFloat(editingPensum!.value)||null as any);setEditingPensum(null)}}
                            onKeyDown={e=>{
                              if(e.key==='Enter'){onSetPensum?.(person,parseFloat(editingPensum!.value)||null as any);setEditingPensum(null)}
                              if(e.key==='Escape')setEditingPensum(null)
                            }}
                            className="w-full text-[10px] text-center border border-primary-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500 no-spinners"
                          />
                        ):(
                          <span
                            onClick={()=>isAdmin?setEditingPensum({person,value:String(pensumVal??'')}):undefined}
                            className={`text-[10px] font-medium ${pensumVal!=null?'text-gray-700':'text-gray-300'} ${isAdmin?'cursor-pointer hover:text-primary-600':''}`}
                            title={isAdmin?'Klicken zum Bearbeiten':undefined}>
                            {pensumVal!=null?`${pensumVal}%`:'—'}
                          </span>
                        )}
                      </td>
                    )
                  })()}
                  {/* Tage ist/soll */}
                  {showPensum&&(()=>{
                    const ad=assignedDays(person)
                    const pensumVal=data.pensum?.[person]
                    const expected=pensumVal!=null&&totalWorkdays>0?Math.round(totalWorkdays*pensumVal/100*10)/10:null
                    const fmt=(n:number)=>n%1===0?String(n):n.toFixed(1)
                    const color=expected==null?'text-gray-500':ad>=expected?'text-green-600':ad>=expected*0.8?'text-amber-500':'text-red-500'
                    return(
                      <td className={`text-center border-r border-gray-100 py-1 px-1 w-16 ${isHovRow?'bg-primary-50/60':pi%2===0?'bg-white':'bg-gray-50/50'}`}>
                        {expected!=null?(
                          <span className={`text-[10px] font-medium ${color}`}>
                            {fmt(ad)}<span className="opacity-50 font-normal">/{fmt(expected)}</span>
                          </span>
                        ):ad>0?(
                          <span className="text-[10px] font-medium text-gray-500">{fmt(ad)}</span>
                        ):<span className="text-[10px] text-gray-300">—</span>}
                      </td>
                    )
                  })()}
                  {days.map(({d,key,isWeekend,ftName,monthIdx,isCurrentMonth})=>{
                    const code=ps[key]
                    const isHovCol=hoveredCol===key
                    const isMonthStart=showMonthSep&&d===1&&isCurrentMonth
                    const isToday=key===TODAY
                    const highlight=isHovRow||isHovCol
                    const selKey=`${person}::${key}`
                    const isSelected=multiSel?.has(selKey)
                    const isOutOfMonth=!isCurrentMonth
                    return(
                      <td key={key}
                        onMouseEnter={()=>{setHoveredCol(key);onCellMouseEnter?.(person,key)}}
                        onMouseDown={()=>onCellMouseDown?.(person,key)}
                        onClick={e=>onCellClick(e,person,key)}
                        onDoubleClick={e=>onCellDoubleClick?.(e,person,key)}
                        className={`group/cell py-1 text-center border-r border-gray-100 cursor-pointer transition-all select-none relative overflow-visible opacity-${isOutOfMonth?'50':'100'}
                          ${isMonthStart?'border-l-2 border-l-gray-300':''}
                          ${isSelected?'bg-primary-200 ring-2 ring-inset ring-primary-500':highlight?'ring-1 ring-inset ring-primary-300':''}
                          ${!isSelected&&(isHovRow&&isHovCol?'bg-primary-300':isHovCol?'bg-primary-200':isToday?'bg-primary-100':isOutOfMonth?'bg-gray-25':ftName?'bg-orange-50':isWeekend?'bg-gray-50':'')}
                          ${showMonthSep?'w-7':'w-9'}`}>
                        {(()=>{const comment=comments?.[person]?.[key];return(<>
                          {code?<span className={`inline-block px-0.5 rounded text-[10px] font-semibold leading-tight ${isSelected?'ring-1 ring-primary-600':''}${CODE_STYLE[code]??'bg-gray-100 text-gray-700'}`}>{code}</span>:
                            isSelected?<span className="inline-block w-3 h-3 rounded bg-primary-400 opacity-60"/>:null}
                          {comment&&<>
                            <span className="absolute top-0 right-0 w-0 h-0 border-t-[5px] border-r-[5px] border-t-transparent border-r-orange-400 pointer-events-none"/>
                            <span className="absolute hidden group-hover/cell:block bottom-full left-1/2 -translate-x-1/2 z-50 px-2 py-1 bg-gray-800 text-white text-[10px] rounded shadow-lg whitespace-pre-wrap max-w-[180px] pointer-events-none mb-0.5 text-left">{comment}</span>
                          </>}
                        </>)})()}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {isAdmin&&(
              <tr key={`add-${section.label}`} className="bg-white border-b border-gray-200">
                <td colSpan={days.length+1+(showPensum?2:0)} className="px-3 py-1.5">
                  {addingTo===section.label?(
                    <div className="flex items-center gap-2">
                      <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
                        onKeyDown={e=>{if(e.key==='Enter')onAddPerson(section.label);if(e.key==='Escape')setAddingTo(null)}}
                        placeholder="Name eingeben…" className="input text-xs py-1 px-2 h-7 w-48"/>
                      <button onClick={()=>onAddPerson(section.label)} className="px-2 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">Hinzufügen</button>
                      <button onClick={()=>{setAddingTo(null);setNewName('')}} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5"/></button>
                    </div>
                  ):(
                    <button onClick={()=>setAddingTo(section.label)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600 transition-colors">
                      <Plus className="w-3.5 h-3.5"/> Person hinzufügen
                    </button>
                  )}
                </td>
              </tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  )
}

// ── Year calendar view (months side by side, names in cells, tabs per section) ─

function YearCalendarView({data,yearDays,year,onPersonClick}:{
  data:PlanungData;yearDays:DayInfo[];year:number;onPersonClick:(p:string)=>void
}){
  const [tab,setTab]=useState(0)
  const [filterPerson,setFilterPerson]=useState<string>('all')
  const section=data.sections[tab]??data.sections[0]

  // Reset person filter when switching sections
  const handleTabChange=(i:number)=>{ setTab(i); setFilterPerson('all') }

  // Build a stable color map: person name → color class (by section order)
  const personColorMap = useMemo(()=>{
    const map: Record<string,string> = {}
    ;(data.sections[tab]??data.sections[0]).persons.forEach((p,i)=>{
      map[p] = YEAR_PERSON_COLORS[i % YEAR_PERSON_COLORS.length]
    })
    return map
  },[data.sections, tab])

  // Group days by month
  const byMonth:DayInfo[][]=Array.from({length:12},(_,mi)=>yearDays.filter(d=>d.monthIdx===mi))

  // Persons to show (all or filtered)
  const visiblePersons = filterPerson==='all' ? section.persons : section.persons.filter(p=>p===filterPerson)

  return(
    <div className="flex flex-col">
      {/* Section tabs + person filter */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 pt-2 gap-3">
        <div className="flex items-center">
          {data.sections.map((s,i)=>(
            <button key={s.label} onClick={()=>handleTabChange(i)}
              className={`px-5 py-2 text-sm font-semibold border-b-2 transition-colors mr-1
                ${tab===i?'border-primary-600 text-primary-700':'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2 shrink-0">
          <select value={filterPerson} onChange={e=>setFilterPerson(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400">
            <option value="all">Alle</option>
            {section.persons.map(p=>(
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {filterPerson!=='all'&&(
            <button onClick={()=>setFilterPerson('all')}
              className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1 rounded hover:bg-gray-100 transition-colors">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2 cols mobile, 4 cols desktop */}
      <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        {byMonth.map((days,mi)=>(
          <div key={mi} className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            {/* Month header */}
            <div className="bg-primary-700 text-white px-3 py-1.5 font-bold text-[11px] uppercase tracking-widest">
              {MONTHS[mi]} {year}
            </div>
            {/* Day rows */}
            <div className="flex-1 divide-y divide-gray-100">
              {days.map(day=>{
                const assigned=visiblePersons
                  .map(p=>({p,code:data.schedule[p]?.[day.key]}))
                  .filter(({code})=>!!code)
                const isFt=!!day.ftName
                const isWe=day.isWeekend
                const isToday=day.key===TODAY
                const vmCount=tab===0&&!isWe&&!isFt?visiblePersons.filter(p=>{const c=data.schedule[p]?.[day.key];return!!(c&&VM_CODES_SET.has(c))}).length:2
                const nmCount=tab===0&&!isWe&&!isFt?visiblePersons.filter(p=>{const c=data.schedule[p]?.[day.key];return!!(c&&NM_CODES_SET.has(c))}).length:2
                const emptySat=isWe&&assigned.length===0&&!isFt&&day.dow===6
                const emptySun=isWe&&assigned.length===0&&!isFt&&day.dow===0
                // Skip empty non-holiday weekdays (not today)
                const emptyWeekday=!isWe&&!isFt&&assigned.length===0&&!isToday
                if(emptyWeekday) return null
                // Compact row for empty weekends
                if((emptySat||emptySun)&&!isToday){
                  return(
                    <div key={day.key} className="flex items-center gap-1 px-1.5 py-px bg-gray-50/60">
                      <span className="w-[38px] shrink-0 text-[8px] text-gray-300 whitespace-nowrap">
                        {WEEKDAY_SHORT[day.dow]} {day.d}.
                      </span>
                    </div>
                  )
                }
                return(
                  <div key={day.key}
                    {...(isToday?{'data-year-today':'true'}:{})}
                    className={`flex items-start gap-1 px-1.5 py-0.5
                      ${isToday?'bg-primary-600':isFt?'bg-orange-50':isWe?'bg-gray-50/80':'bg-white'}`}>
                    {/* Date */}
                    <span className={`w-[38px] shrink-0 text-[9px] font-bold whitespace-nowrap leading-tight pt-px
                      ${isToday?'text-white':isFt?'text-orange-500':isWe?'text-gray-300':'text-gray-500'}`}>
                      {WEEKDAY_SHORT[day.dow]} {day.d}.
                    </span>
                    {/* Content */}
                    <div className="flex-1 flex flex-col gap-px min-h-[14px]">
                      {isFt&&(
                        <span className={`text-[8.5px] font-semibold leading-tight ${isToday?'text-primary-100':'text-orange-600'}`}>{day.ftName}</span>
                      )}
                      {assigned.map(({p,code})=>{
                        const short=p.includes(' ')?p.split(' ')[0]:p
                        const isAbsence = YEAR_ABSENCE_CODES.has(code!)
                        const colorCls = isToday
                          ? 'bg-white/20 text-white'
                          : isAbsence
                            ? (CODE_STYLE[code!] ?? 'bg-gray-100 text-gray-600')
                            : (personColorMap[p] ?? 'bg-gray-100 text-gray-700')
                        return(
                          <button key={p} onClick={()=>onPersonClick(p)} title={p}
                            className={`inline-flex items-center gap-0.5 px-1 rounded text-[8.5px] font-semibold leading-tight w-fit hover:opacity-80 transition-opacity ${colorCls}`}>
                            {short} <span className="opacity-60">{code}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface Popover{person:string;date:string;x:number;y:number}
const DEFAULT_YEARS=[2024,2025,2026,2027,2028]
const YEARS_KEY='planung_years'
// ── Persönlicher Bereich Modal ────────────────────────────────────────────────

interface PlanungRequest {
  id?: string
  type: 'eintrag' | 'ferien' | 'tausch' | 'absage'
  uid: string
  username: string
  personName?: string   // Plan-Schlüssel (Display-Name), gesetzt bei eintrag/absage
  dates?: string[]
  code?: string
  section?: string
  fromDate?: string
  toDate?: string
  note?: string
  ferienType?: FerienType
  // tausch fields
  myDate?: string
  myCode?: string
  myPerson?: string
  theirDate?: string
  theirCode?: string
  theirPerson?: string
  year?: number
  status: 'pending' | 'approved' | 'provisional' | 'rejected' | 'adjustment' | 'withdrawn' | 'dismissed'
  adminArchived?: boolean
  userArchived?: boolean
  readByUser?: boolean
  createdAt?: unknown
  adminNote?: string
}

// ── Einsatztausch Modal ───────────────────────────────────────────────────────

function EinsatztauschModal({onClose,data,yearDays,year}:{
  onClose:()=>void;data:PlanungData;yearDays:DayInfo[];year:number
}){
  const { profile } = useAuth()
  // Find the user's name in the planning — displayName → username
  const allPersons2 = data.sections.flatMap(s=>s.persons)
  const myPlanName = (
    allPersons2.find(p=>p===profile?.displayName) ||
    allPersons2.find(p=>p===profile?.username) ||
    ''
  )

  // Find section of a person
  const getSectionOf = (personName: string) =>
    data.sections.find(s => s.persons.includes(personName))

  // Determine the initial section based on myPlanName
  const mySection = myPlanName ? getSectionOf(myPlanName) : null

  const [myDate, setMyDate] = useState('')
  const [theirPerson, setTheirPerson] = useState('')
  const [theirDate, setTheirDate] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // My assigned future days
  const myDays = yearDays.filter(d =>
    !d.isWeekend && d.key >= TODAY && !!data.schedule[myPlanName]?.[d.key]
  )

  // Other persons in same section (excluding self)
  const sectionPersons = (mySection?.persons ?? []).filter(p => p !== myPlanName)

  // Their assigned future days
  const theirDays = theirPerson
    ? yearDays.filter(d => !d.isWeekend && d.key >= TODAY && !!data.schedule[theirPerson]?.[d.key])
    : []

  const myCode = myDate ? (data.schedule[myPlanName]?.[myDate] ?? '') : ''
  const theirCode = theirDate ? (data.schedule[theirPerson]?.[theirDate] ?? '') : ''

  const formatDate = (key: string) => {
    const d = new Date(key)
    return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`
  }

  const handleSubmit = async () => {
    if(!profile || !myDate || !theirPerson || !theirDate) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'planungRequests'), {
        type: 'tausch',
        uid: profile.uid,
        username: profile.displayName||profile.username,
        myDate,
        myCode,
        myPerson: myPlanName,
        theirDate,
        theirCode,
        theirPerson,
        section: mySection?.label ?? '',
        year,
        note,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      // Add pending entries to plan — atomic dot-notation, old entries untouched
      const planRef = doc(db, 'planung', String(year))
      const planUpdate: Record<string, unknown> = {
        [`comments.${myPlanName}.${theirDate}`]: 'warten auf Freigabe',
        [`comments.${theirPerson}.${myDate}`]: 'warten auf Freigabe',
      }
      if (theirCode) planUpdate[`schedule.${myPlanName}.${theirDate}`] = theirCode
      if (myCode)    planUpdate[`schedule.${theirPerson}.${myDate}`]   = myCode
      await updateDoc(planRef, planUpdate)
      setSubmitted(true)
      setTimeout(onClose, 1800)
    } catch(e) { console.error(e) } finally { setSubmitting(false) }
  }

  if(submitted) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-3">
          <div className="text-4xl">✅</div>
          <p className="text-lg font-semibold text-gray-800">Tauschantrag eingereicht!</p>
          <p className="text-sm text-gray-500">Der Administrator wird benachrichtigt.</p>
        </div>
      </div>
    )
  }

  if(!myPlanName) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4" onClick={e=>e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Einsatztausch</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
          </div>
          <p className="text-sm text-gray-500">Dein Name wurde nicht im Einsatzplan gefunden. Bitte wende dich an den Administrator.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-teal-600"/>
              Einsatztausch
            </h2>
            <p className="text-sm text-gray-500">Als <strong>{myPlanName}</strong> — {mySection?.label ?? ''}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* My day */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Mein Tag (abgeben)</div>
            {myDays.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Keine zukünftigen Arbeitstage geplant</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {myDays.map(day => {
                  const code = data.schedule[myPlanName]?.[day.key] ?? ''
                  const isSel = myDate === day.key
                  return (
                    <button key={day.key} onClick={() => { setMyDate(isSel ? '' : day.key) }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border flex items-center gap-1
                        ${isSel
                          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300 hover:text-teal-600'}`}>
                      {formatDate(day.key)}
                      {code && <span className={`inline-block px-1 rounded text-[10px] font-bold ${isSel ? 'bg-white/20' : (CODE_STYLE[code] ?? 'bg-gray-100 text-gray-700')}`}>{code}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Their person */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Tauschpartner</div>
            {sectionPersons.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Keine anderen Personen in dieser Sektion</p>
            ) : (
              <select value={theirPerson} onChange={e => { setTheirPerson(e.target.value); setTheirDate('') }}
                className="input text-sm py-1.5 h-9 w-full">
                <option value="">— Person auswählen —</option>
                {sectionPersons.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {/* Their day */}
          {theirPerson && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Tag von {theirPerson} (übernehmen)</div>
              {theirDays.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Keine zukünftigen Arbeitstage für {theirPerson} geplant</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {theirDays.map(day => {
                    const code = data.schedule[theirPerson]?.[day.key] ?? ''
                    const isSel = theirDate === day.key
                    return (
                      <button key={day.key} onClick={() => setTheirDate(isSel ? '' : day.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border flex items-center gap-1
                          ${isSel
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300 hover:text-teal-600'}`}>
                        {formatDate(day.key)}
                        {code && <span className={`inline-block px-1 rounded text-[10px] font-bold ${isSel ? 'bg-white/20' : (CODE_STYLE[code] ?? 'bg-gray-100 text-gray-700')}`}>{code}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {myDate && theirPerson && theirDate && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
              <span className="font-semibold">Zusammenfassung: </span>
              Du tauschst <strong>{formatDate(myDate)}</strong>{myCode && <> (<span className={`inline-block px-1 rounded text-[10px] font-bold ${CODE_STYLE[myCode] ?? 'bg-gray-100 text-gray-700'}`}>{myCode}</span>)</>}{' '}
              mit <strong>{theirPerson}</strong> am <strong>{formatDate(theirDate)}</strong>{theirCode && <> (<span className={`inline-block px-1 rounded text-[10px] font-bold ${CODE_STYLE[theirCode] ?? 'bg-gray-100 text-gray-700'}`}>{theirCode}</span>)</>}.
            </div>
          )}

          {/* Note */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Bemerkung (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Optionale Bemerkung…"
              rows={2}
              className="input text-sm py-2 resize-none w-full"/>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50/60">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Abbrechen</button>
          <button onClick={handleSubmit}
            disabled={!myDate || !theirPerson || !theirDate || submitting}
            className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
            {submitting ? 'Wird eingereicht…' : 'Tausch beantragen'}
          </button>
        </div>
      </div>
    </div>
  )
}

const FERIEN_TYPES = [
  { value: 'ferien',       label: 'Ferien',                    emoji: '🏖️', code: 'Fer' },
  { value: 'kurs',         label: 'Kurs / Weiterbildung',      emoji: '📚', code: 'W'   },
  { value: 'kongress',     label: 'Kongress / Tagung',         emoji: '🏛️', code: 'W'   },
  { value: 'militaer',     label: 'Militär / Zivildienst',     emoji: '🎖️', code: 'M'   },
  { value: 'ausgleich',    label: 'Ausgleich',                 emoji: '⚖️', code: 'AG'  },
  { value: 'mutterschaft', label: 'Mutterschaft / Vaterschaft',emoji: '👶', code: 'MV'  },
  { value: 'umzug',        label: 'Umzug',                     emoji: '📦', code: 'UZ'  },
  { value: 'sonstiges',    label: 'Sonstiges',                 emoji: '📝', code: 'A'   },
] as const
type FerienType = typeof FERIEN_TYPES[number]['value']
function ferienTypeCode(ft?: string): string {
  return FERIEN_TYPES.find(t=>t.value===ft)?.code ?? 'Fer'
}

interface EditFerienRequest { id:string; fromDate?:string; toDate?:string; note?:string; ferienType?:FerienType; adjustmentSuggestions?:{fromDate:string;toDate:string}[] }

function PersonalBereichModal({onClose,isAdmin,data,yearDays,year,requests,editFerienRequest,initialTab,highlightRequestId}:{
  onClose:()=>void;isAdmin:boolean
  data:PlanungData;yearDays:DayInfo[];year:number
  requests:PlanungRequest[]
  editFerienRequest?:EditFerienRequest
  initialTab?:'ferien'|'einsaetze'|'abwesenheiten'|'antraege'
  highlightRequestId?:string
}){
  const { profile, isGeschaeftsleitung } = useAuth()
  const canDirectEdit = isAdmin || isGeschaeftsleitung
  const navigate = useNavigate()
  const [tab,setTab]=useState<'ferien'|'einsaetze'|'abwesenheiten'|'antraege'>(
    editFerienRequest?'ferien':initialTab??'ferien'
  )

  // Own live subscriptions — modal is always up-to-date, independent of parent state

  // 1) Requests live — no orderBy to avoid composite index requirement; sort in JS
  const [liveRequests,setLiveRequests]=useState<PlanungRequest[]>(requests)
  useEffect(()=>{
    if(!profile?.uid)return
    const q=query(collection(db,'planungRequests'),where('uid','==',profile.uid))
    return onSnapshot(q,snap=>{
      const sorted=snap.docs
        .map(d=>({id:d.id,...d.data()} as PlanungRequest))
        .sort((a,b)=>((b.createdAt as any)?.seconds??0)-((a.createdAt as any)?.seconds??0))
      setLiveRequests(sorted)
    })
  },[profile?.uid])

  // 2) Plan data live — no hasPendingWrites skip, so updates immediately after user writes
  const [liveData,setLiveData]=useState<PlanungData>(data)
  useEffect(()=>{
    return onSnapshot(doc(db,'planung',String(year)),snap=>{
      if(snap.exists()) setLiveData(snap.data() as PlanungData)
    })
  },[year])

  // Mark all as read when Anträge tab is opened
  useEffect(()=>{
    if(tab!=='antraege'||!liveRequests.length)return
    const unread=liveRequests.filter(r=>r.readByUser===false)
    if(!unread.length)return
    void Promise.all(unread.map(r=>updateDoc(doc(db,'planungRequests',r.id!),{readByUser:true})))
  },[tab])

  // Scroll highlighted request into view when tab is active
  useEffect(()=>{
    if(!highlightRequestId)return
    const el=document.getElementById(`req-${highlightRequestId}`)
    if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'})
  },[tab,highlightRequestId,liveRequests])

  // Track which ferien request is being edited inline (overrides prop)
  const [inlineEditFerien,setInlineEditFerien]=useState<EditFerienRequest|undefined>(undefined)
  const activeEditFerien = inlineEditFerien ?? editFerienRequest

  // Ferien
  const [fromDate,setFromDate]=useState(editFerienRequest?.fromDate??'')
  const [toDate,setToDate]=useState(editFerienRequest?.toDate??'')
  const [ferienNote,setFerienNote]=useState(editFerienRequest?.note??'')
  const [ferienType,setFerienType]=useState<FerienType>(editFerienRequest?.ferienType??'ferien')
  const [ferienSubmitting,setFerienSubmitting]=useState(false)
  const [ferienError,setFerienError]=useState('')
  const [ferienSuccess,setFerienSuccess]=useState(false)
  const [successMsg,setSuccessMsg]=useState('')
  const showSuccess=(msg:string)=>{setSuccessMsg(msg);setTimeout(()=>setSuccessMsg(''),2500)}
  const [archiveOpen,setArchiveOpen]=useState(false)
  const [einsatzArchiveOpen,setEinsatzArchiveOpen]=useState(false)
  const [abwesenheitArchiveOpen,setAbwesenheitArchiveOpen]=useState(false)

  // Tauschen (inline in Meine Einsätze)
  const [tauschDay,setTauschDay]=useState<{key:string;code:string}|null>(null)
  const [tauschMode,setTauschMode]=useState<'date'|'person'>('date')
  const [tauschTargetDate,setTauschTargetDate]=useState('')
  const [tauschTargetPerson,setTauschTargetPerson]=useState('')
  const [tauschTheirDate,setTauschTheirDate]=useState('')
  const [tauschSubmitting,setTauschSubmitting]=useState(false)

  // Ändern (inline in Meine Einsätze)
  const [aendernDay,setAendernDay]=useState<{key:string;code:string}|null>(null)
  const [aendernNewCode,setAendernNewCode]=useState<string>('')
  const [aendernNote,setAendernNote]=useState('')
  const [aendernSubmitting,setAendernSubmitting]=useState(false)

  // Abwesenheit stornieren / ändern
  const [stornierenId,setStornierenId]=useState<string|null>(null)
  const [stornierenSubmitting,setStornierenSubmitting]=useState(false)

  // Einsatz anfragen (neue Anfrage für einen einzelnen Tag)
  const [einsatzFormOpen,setEinsatzFormOpen]=useState(false)
  const [einsatzDate,setEinsatzDate]=useState('')
  const [einsatzCode,setEinsatzCode]=useState<string>('GT')
  const [einsatzNote,setEinsatzNote]=useState('')
  const [einsatzSubmitting,setEinsatzSubmitting]=useState(false)

  const handleFerien=async()=>{
    if(!profile||!fromDate||!toDate)return
    setFerienError('');setFerienSubmitting(true)
    const username=profile.displayName||profile.username||''
    try{
      if(activeEditFerien?.id){
        // Edit existing request — remove old entries, update doc
        if(username&&activeEditFerien.fromDate&&activeEditFerien.toDate)
          await manageFerienPlan(username,activeEditFerien.fromDate,activeEditFerien.toDate,'remove')
        await updateDoc(doc(db,'planungRequests',activeEditFerien.id),{
          fromDate,toDate,note:ferienNote,ferienType,status:'pending',
          adminNote:deleteField(),actionBy:deleteField(),actionAt:deleteField()
        })
      }else{
        // New request (also covers pre-fill from direct plan entry — id is empty)
        await addDoc(collection(db,'planungRequests'),{
          type:'ferien',uid:profile.uid,username,
          fromDate,toDate,note:ferienNote,ferienType,
          status:'pending',createdAt:serverTimestamp(),
        })
      }
      // Write new entries to plan
      if(username) await manageFerienPlan(username,fromDate,toDate,'write','warten auf Freigabe',ferienTypeCode(ferienType))
      setFromDate('');setToDate('');setFerienNote('');setFerienType('ferien')
      setInlineEditFerien(undefined)
      setFerienSuccess(true)
      setTimeout(()=>{setFerienSuccess(false);setTab('abwesenheiten')},1500)
    }catch(e:any){
      setFerienError(e?.message||'Fehler beim Einreichen. Bitte nochmals versuchen.')
    }finally{setFerienSubmitting(false)}
  }

  const handleAendern=async()=>{
    if(!profile||!aendernDay||!userPersonName)return
    setAendernSubmitting(true)
    try{
      await addDoc(collection(db,'planungRequests'),{
        type:'absage',uid:profile.uid,
        username:profile.username||profile.displayName,
        myDate:aendernDay.key,myCode:aendernDay.code,myPerson:userPersonName,year,
        newCode:aendernNewCode||null,
        note:aendernNote.trim()||null,
        status:'pending',createdAt:serverTimestamp(),
      })
      // Apply change immediately to plan with comment — atomic dot-notation
      const planRef=doc(db,'planung',String(year))
      const update:Record<string,unknown>={
        [`comments.${userPersonName}.${aendernDay.key}`]:'warten auf Freigabe',
      }
      if(aendernNewCode) update[`schedule.${userPersonName}.${aendernDay.key}`]=aendernNewCode
      await updateDoc(planRef,update)
      setAendernDay(null);setAendernNewCode('');setAendernNote('')
      showSuccess('✅ Änderungsanfrage eingereicht!')
    }catch(e){console.error(e)}finally{setAendernSubmitting(false)}
  }

  const handleTausch=async()=>{
    if(!profile||!tauschDay||!userPersonName)return
    setTauschSubmitting(true)
    try{
      const req:Record<string,unknown>={
        type:'tausch',uid:profile.uid,
        username:profile.username||profile.displayName,
        myDate:tauschDay.key,myCode:tauschDay.code,myPerson:userPersonName,
        year,status:'pending',createdAt:serverTimestamp(),
      }
      if(tauschMode==='date'){
        req.theirDate=tauschTargetDate
        req.theirPerson=''
        req.theirCode=''
        req.note=`Wunschdatum: ${tauschTargetDate}`
      } else {
        req.theirDate=tauschTheirDate
        req.theirPerson=tauschTargetPerson
        req.theirCode=liveData.schedule[tauschTargetPerson]?.[tauschTheirDate]??''
      }
      await addDoc(collection(db,'planungRequests'),req)
      // Add pending entries to plan — atomic dot-notation, old entries untouched
      const planRef=doc(db,'planung',String(year))
      const planUpdate:Record<string,unknown>={}
      if(tauschMode==='date'){
        planUpdate[`schedule.${userPersonName}.${tauschTargetDate}`]=tauschDay.code
        planUpdate[`comments.${userPersonName}.${tauschTargetDate}`]='warten auf Freigabe'
      } else {
        const codeA=liveData.schedule[userPersonName]?.[tauschDay.key]??tauschDay.code
        const codeB=liveData.schedule[tauschTargetPerson]?.[tauschTheirDate]??''
        if(codeB) planUpdate[`schedule.${userPersonName}.${tauschTheirDate}`]=codeB
        if(codeA) planUpdate[`schedule.${tauschTargetPerson}.${tauschDay.key}`]=codeA
        planUpdate[`comments.${userPersonName}.${tauschTheirDate}`]='warten auf Freigabe'
        planUpdate[`comments.${tauschTargetPerson}.${tauschDay.key}`]='warten auf Freigabe'
      }
      if(Object.keys(planUpdate).length>0) await updateDoc(planRef,planUpdate)
      setTauschDay(null);setTauschTargetDate('');setTauschTargetPerson('');setTauschTheirDate('')
      showSuccess('✅ Tausch beantragt!')
    }catch(e){console.error(e)}finally{setTauschSubmitting(false)}
  }

  const handleStornieren=async(r:PlanungRequest)=>{
    if(!profile||!r.id)return
    setStornierenSubmitting(true)
    try{
      const username=profile.displayName||profile.username||''
      if(username&&r.fromDate&&r.toDate)
        await manageFerienPlan(username,r.fromDate,r.toDate,'remove')
      await updateDoc(doc(db,'planungRequests',r.id),{
        status:'withdrawn' as any,
        actionBy:profile.displayName||profile.username||'',
        actionAt:serverTimestamp(),
        readByUser:true,
      })
      setStornierenId(null)
      showSuccess('✅ Abwesenheit storniert!')
    }catch(e){console.error(e)}finally{setStornierenSubmitting(false)}
  }

  const handleAendernAbwesenheit=(r:PlanungRequest)=>{
    setInlineEditFerien({
      id:r.id!,fromDate:r.fromDate,toDate:r.toDate,
      note:r.note,ferienType:r.ferienType as FerienType|undefined,
      adjustmentSuggestions:(r as any).adjustmentSuggestions,
    })
    setFromDate(r.fromDate??'')
    setToDate(r.toDate??'')
    setFerienNote(r.note??'')
    setFerienType((r.ferienType as FerienType|undefined)??'ferien')
    setTab('ferien')
  }

  const handleEinsatzRequest=async()=>{
    if(!profile||!einsatzDate||!einsatzCode||!userPersonName)return
    setEinsatzSubmitting(true)
    try{
      if(canDirectEdit){
        // Admin/GL: direkt eintragen, kein Request, keine Freigabe nötig
        await writePlanEntry(userPersonName,[einsatzDate],einsatzCode,'')
      }else{
        const sectionLabel=liveData.sections.find(s=>s.persons.includes(userPersonName))?.label??''
        await addDoc(collection(db,'planungRequests'),{
          type:'eintrag',uid:profile.uid,
          username:profile.username||profile.displayName,
          personName:userPersonName,
          dates:[einsatzDate],code:einsatzCode,section:sectionLabel,
          note:einsatzNote.trim()||null,
          status:'pending',createdAt:serverTimestamp(),
        })
        await writePlanEntry(userPersonName,[einsatzDate],einsatzCode,'warten auf Freigabe')
      }
      setEinsatzDate('');setEinsatzCode('GT');setEinsatzNote('');setEinsatzFormOpen(false)
      showSuccess(canDirectEdit?'✅ Einsatz eingetragen!':'✅ Einsatz beantragt!')
    }catch(e){console.error(e)}finally{setEinsatzSubmitting(false)}
  }

  // Find the user's name in the planning — displayName (= Vor- und Nachname) → username
  const allPlanPersons=liveData.sections.flatMap(s=>s.persons)
  const userPersonName=(
    allPlanPersons.find(p=>p===profile?.displayName)||
    allPlanPersons.find(p=>p===profile?.username)||
    ''
  )

  // Ferien/absence codes — used to split "Einsätze" vs "Abwesenheiten"
  const FERIEN_CODES=new Set(['OP','W','Fer','K','A','AG'])

  // User's assigned days — split by future/past and type
  const myAllAssignedDays=userPersonName
    ? yearDays.filter(d=>liveData.schedule[userPersonName]?.[d.key])
    : []
  const myAssignedDays=myAllAssignedDays.filter(d=>d.key>=TODAY)
  const myEinsatzDays=myAssignedDays.filter(d=>!FERIEN_CODES.has(liveData.schedule[userPersonName]?.[d.key]??''))
  const myAbwesenheitDays=myAssignedDays.filter(d=>FERIEN_CODES.has(liveData.schedule[userPersonName]?.[d.key]??''))
  const myPastEinsatzDays=myAllAssignedDays.filter(d=>d.key<TODAY&&!FERIEN_CODES.has(liveData.schedule[userPersonName]?.[d.key]??'')).reverse()
  const myPastAbwesenheitDays=myAllAssignedDays.filter(d=>d.key<TODAY&&FERIEN_CODES.has(liveData.schedule[userPersonName]?.[d.key]??'')).reverse()

  // Format Firestore timestamp
  const fmtTs=(ts:unknown)=>{
    const sec=(ts as any)?.seconds
    if(!sec)return''
    return new Date(sec*1000).toLocaleDateString('de-CH',{day:'2-digit',month:'2-digit',year:'numeric'})
  }
  // Label for ferien code
  const ferienCodeLabel=(code:string)=>{
    const t=FERIEN_TYPES.find(ft=>ft.code===code)
    return t?`${t.emoji} ${t.label}`:code
  }

  // All other persons in the same section as the user (for tausch)
  const mySection=liveData.sections.find(s=>s.persons.includes(userPersonName))
  const otherPersons=mySection?mySection.persons.filter(p=>p!==userPersonName):[]

  // Days of selected tausch partner
  const partnerDays=tauschTargetPerson
    ? yearDays.filter(d=>d.key>=TODAY&&liveData.schedule[tauschTargetPerson]?.[d.key])
    : []

  const statusLabel=(s:string)=>{
    const base="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5"
    if(s==='approved')    return<span className={`${base} text-green-700 bg-green-50 border border-green-200`}>✓ Genehmigt</span>
    if(s==='provisional') return<span className={`${base} text-yellow-700 bg-yellow-50 border border-yellow-300`}>◑ Provisorisch</span>
    if(s==='rejected')    return<span className={`${base} text-red-600 bg-red-50 border border-red-200`}>✕ Abgelehnt</span>
    if(s==='adjustment')  return<span className={`${base} text-orange-700 bg-orange-50 border border-orange-200`}>↩ Anpassung nötig</span>
    if(s==='withdrawn')   return<span className={`${base} text-gray-500 bg-gray-100 border border-gray-300`}>↩ Storniert</span>
    return<span className={`${base} text-blue-600 bg-blue-50 border border-blue-200`}>⏳ Ausstehend</span>
  }

  return(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <User className="w-5 h-5 text-purple-600"/>
              Mein Bereich
            </h2>
            <p className="text-sm text-gray-500">{profile?.username||profile?.displayName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400"/></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4 pt-2 overflow-x-auto shrink-0">
          {(['ferien','einsaetze','abwesenheiten','antraege'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 transition-colors mr-1 whitespace-nowrap
                ${tab===t?'border-purple-600 text-purple-700':'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {(()=>{
                const unreadCount=liveRequests.filter(r=>r.readByUser===false).length
                return t==='ferien'?'Absenheitsmeldung'
                  :t==='einsaetze'?`Einsätze${myEinsatzDays.length>0?` (${myEinsatzDays.length})`:''}`
                  :t==='abwesenheiten'?`Abwesenheiten${myAbwesenheitDays.length>0?` (${myAbwesenheitDays.length})`:''}`
                  :(<>Anträge
                    {liveRequests.filter(r=>r.status!=='withdrawn').length>0&&<span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">{liveRequests.filter(r=>r.status!=='withdrawn').length}</span>}
                    {unreadCount>0&&tab!=='antraege'&&<span className="ml-1 w-2 h-2 rounded-full bg-blue-500 inline-block"/>}
                  </>)
              })()}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Global success toast ── */}
          {successMsg&&(
            <div className="sticky top-0 z-10 mb-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 font-medium flex items-center gap-2 shadow-sm animate-fade-in">
              {successMsg}
            </div>
          )}

          {/* ── Absenheitsmeldung ── */}
          {tab==='ferien'&&(
            <div className="space-y-4">
              {ferienSuccess&&(
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 font-medium flex items-center gap-2">
                  {activeEditFerien ? '✅ Absenheitsmeldung aktualisiert!' : '✅ Absenheitsmeldung erfolgreich eingereicht!'}
                </div>
              )}
              {ferienError&&(
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {ferienError}
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Art der Abwesenheit</span>
                <select value={ferienType} onChange={e=>setFerienType(e.target.value as FerienType)}
                  className="input text-sm py-2 h-10">
                  {FERIEN_TYPES.map(ft=>(
                    <option key={ft.value} value={ft.value}>{ft.emoji} {ft.label}</option>
                  ))}
                </select>
              </label>
              {activeEditFerien?.adjustmentSuggestions && activeEditFerien.adjustmentSuggestions.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-orange-700">Vorgeschlagene Alternativdaten:</p>
                  <div className="space-y-1.5">
                    {activeEditFerien.adjustmentSuggestions.map((s,i)=>(
                      <button key={i}
                        onClick={()=>{setFromDate(s.fromDate);setToDate(s.toDate)}}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${fromDate===s.fromDate&&toDate===s.toDate?'border-orange-400 bg-orange-100 text-orange-800 font-semibold':'border-orange-200 bg-white text-orange-700 hover:bg-orange-50'}`}>
                        {s.fromDate} – {s.toDate}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Von</span>
                  <input type="date" value={fromDate}
                    onChange={e=>{setFromDate(e.target.value);if(toDate&&e.target.value>toDate)setToDate(e.target.value)}}
                    className="input text-sm py-1.5 h-9"/>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bis</span>
                  <input type="date" value={toDate} min={fromDate}
                    onChange={e=>setToDate(e.target.value)}
                    className="input text-sm py-1.5 h-9"/>
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bemerkung (optional)</span>
                <textarea value={ferienNote} onChange={e=>setFerienNote(e.target.value)}
                  placeholder="z.B. Familienurlaub, Hochzeit…"
                  rows={3} className="input text-sm py-2 resize-none"/>
              </label>
              <button onClick={handleFerien} disabled={!fromDate||!toDate||ferienSubmitting}
                className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-semibold">
                {ferienSubmitting?(activeEditFerien?'Wird gespeichert…':'Wird eingereicht…'):(activeEditFerien?'Antrag aktualisieren':'Antrag stellen')}
              </button>
            </div>
          )}

          {/* ── Meine Einsätze ── */}
          {tab==='einsaetze'&&(
            <div className="space-y-2">
              {!userPersonName&&(
                <div className="text-center text-gray-400 py-8 text-sm">
                  Ihr Name wurde in der Planung nicht gefunden.<br/>
                  <span className="text-xs">Bitte den Administrator informieren.</span>
                </div>
              )}
              {userPersonName&&myEinsatzDays.length===0&&!einsatzFormOpen&&myPastEinsatzDays.length===0&&(
                <p className="text-center text-gray-400 py-8 text-sm">Keine Einsätze geplant.</p>
              )}
              {/* Inline-Formular: Einsatz anfragen */}
              {einsatzFormOpen&&(
                <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/40 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{canDirectEdit?'Einsatz eintragen':'Einsatz anfragen'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Datum</span>
                      <input type="date" value={einsatzDate} min={TODAY}
                        onChange={e=>setEinsatzDate(e.target.value)}
                        className="input text-sm py-1.5 h-9"/>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">Einsatzart</span>
                      <select value={einsatzCode} onChange={e=>setEinsatzCode(e.target.value)}
                        className="input text-sm py-1.5 h-9">
                        {ALL_CODES.filter(c=>WORK_CODES.has(c)).map(c=>(
                          <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Notiz / Begründung (optional)</span>
                    <textarea value={einsatzNote} onChange={e=>setEinsatzNote(e.target.value)}
                      rows={2} placeholder="z.B. Vertretung, Sondereinsatz…"
                      className="input text-sm py-1.5 resize-none"/>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={()=>{setEinsatzFormOpen(false);setEinsatzDate('');setEinsatzCode('GT');setEinsatzNote('')}}
                      className="flex-1 py-2 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                      Abbrechen
                    </button>
                    <button onClick={handleEinsatzRequest}
                      disabled={einsatzSubmitting||!einsatzDate||!userPersonName}
                      className="flex-1 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-semibold">
                      {einsatzSubmitting?(canDirectEdit?'Wird gespeichert…':'Wird eingereicht…'):(canDirectEdit?'Eintragen':'Anfrage senden')}
                    </button>
                  </div>
                </div>
              )}
              {userPersonName&&!einsatzFormOpen&&(
                <button onClick={()=>{setEinsatzFormOpen(true);setTauschDay(null);setAendernDay(null)}}
                  className="w-full py-2 text-xs border border-blue-200 text-blue-600 rounded-xl hover:bg-blue-50 transition-colors font-medium flex items-center justify-center gap-1.5">
                  <span className="text-base leading-none">+</span> {canDirectEdit?'Einsatz eintragen':'Einsatz anfragen'}
                </button>
              )}
              {myEinsatzDays.map(day=>{
                const code=liveData.schedule[userPersonName]?.[day.key]??''
                const planComment=(liveData as any).comments?.[userPersonName]?.[day.key]??''
                const isWaiting=planComment==='warten auf Freigabe'
                const isProv=planComment?.startsWith('prov')
                const pendingAendern=liveRequests.some(r=>r.type==='absage'&&r.myDate===day.key&&r.status==='pending')
                const pendingTausch=liveRequests.some(r=>r.type==='tausch'&&r.myDate===day.key&&r.status==='pending')
                const isTauschOpen=tauschDay?.key===day.key
                const isAendernOpen=aendernDay?.key===day.key
                return(
                  <div key={day.key}>
                    <div className={`flex items-center justify-between border rounded-xl px-4 py-2.5 transition-colors
                      ${isTauschOpen?'border-teal-300 bg-teal-50/30'
                        :isAendernOpen?'border-orange-300 bg-orange-50/30'
                        :isWaiting?'border-amber-200 bg-amber-50/30'
                        :isProv?'border-yellow-200 bg-yellow-50/30'
                        :'border-gray-200 bg-white'}`}>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${CODE_STYLE[code]??'bg-gray-100 text-gray-700'}`}>{code}</span>
                        <div>
                          <span className="text-sm text-gray-800">{WEEKDAY_SHORT[day.dow]} {day.d}. {MONTHS_SHORT[day.monthIdx]}</span>
                          {isProv&&<p className="text-xs text-yellow-600 font-medium">◑ Provisorisch genehmigt</p>}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {isWaiting?(
                          <span className="text-xs text-amber-600 font-medium">⏳ Anfrage ausstehend</span>
                        ):pendingTausch?(
                          <span className="text-xs text-teal-600 font-medium">Tausch ausstehend</span>
                        ):(
                          <button
                            onClick={()=>{
                              setTauschDay(isTauschOpen?null:{key:day.key,code})
                              setAendernDay(null)
                              setTauschMode('date');setTauschTargetDate('');setTauschTargetPerson('');setTauschTheirDate('')
                            }}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors font-medium
                              ${isTauschOpen?'bg-teal-100 border-teal-300 text-teal-700':'bg-teal-50 border-teal-200 text-teal-600 hover:bg-teal-100'}`}>
                            ⇄ Tauschen
                          </button>
                        )}
                        {!isWaiting&&(pendingAendern?(
                          <span className="text-xs text-orange-600 font-medium">Änderung ausstehend</span>
                        ):(
                          <button
                            onClick={()=>{
                              setAendernDay(isAendernOpen?null:{key:day.key,code})
                              setTauschDay(null)
                              setAendernNewCode('');setAendernNote('')
                            }}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors font-medium
                              ${isAendernOpen?'bg-orange-100 border-orange-300 text-orange-700':'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100'}`}>
                            ✎ Ändern
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Inline Tausch-Formular */}
                    {isTauschOpen&&(
                      <div className="border border-teal-200 rounded-xl p-4 bg-teal-50/40 mt-1 space-y-3">
                        <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">
                          Tausch für {WEEKDAY_SHORT[day.dow]} {day.d}. {MONTHS_SHORT[day.monthIdx]} ({code})
                        </p>
                        {/* Mode toggle */}
                        <div className="flex rounded-lg border border-teal-200 overflow-hidden text-xs font-semibold">
                          <button onClick={()=>setTauschMode('date')}
                            className={`flex-1 py-1.5 transition-colors ${tauschMode==='date'?'bg-teal-600 text-white':'bg-white text-teal-600 hover:bg-teal-50'}`}>
                            Wunschdatum
                          </button>
                          <button onClick={()=>setTauschMode('person')}
                            className={`flex-1 py-1.5 transition-colors ${tauschMode==='person'?'bg-teal-600 text-white':'bg-white text-teal-600 hover:bg-teal-50'}`}>
                            Mit Mitarbeiter
                          </button>
                        </div>

                        {tauschMode==='date'&&(
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-gray-500">Gewünschtes Datum (Admin entscheidet Tauschpartner)</span>
                            <input type="date" value={tauschTargetDate} min={TODAY}
                              onChange={e=>setTauschTargetDate(e.target.value)}
                              className="input text-sm py-1.5 h-9"/>
                          </label>
                        )}

                        {tauschMode==='person'&&(
                          <div className="space-y-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-gray-500">Mitarbeiter auswählen</span>
                              <select value={tauschTargetPerson}
                                onChange={e=>{setTauschTargetPerson(e.target.value);setTauschTheirDate('')}}
                                className="input text-sm py-1.5 h-9">
                                <option value="">— Mitarbeiter wählen —</option>
                                {otherPersons.map(p=><option key={p} value={p}>{p}</option>)}
                              </select>
                            </label>
                            {tauschTargetPerson&&(
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-gray-500">Einsatz von {tauschTargetPerson}</span>
                                <select value={tauschTheirDate}
                                  onChange={e=>setTauschTheirDate(e.target.value)}
                                  className="input text-sm py-1.5 h-9">
                                  <option value="">— Tag wählen —</option>
                                  {partnerDays.map(d=>{
                                    const c=liveData.schedule[tauschTargetPerson]?.[d.key]??''
                                    return<option key={d.key} value={d.key}>{WEEKDAY_SHORT[d.dow]} {d.d}. {MONTHS_SHORT[d.monthIdx]} ({c})</option>
                                  })}
                                </select>
                              </label>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          <button onClick={()=>setTauschDay(null)}
                            className="flex-1 py-2 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                            Abbrechen
                          </button>
                          <button onClick={handleTausch} disabled={
                            tauschSubmitting||
                            (tauschMode==='date'&&!tauschTargetDate)||
                            (tauschMode==='person'&&(!tauschTargetPerson||!tauschTheirDate))
                          }
                            className="flex-1 py-2 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-semibold">
                            {tauschSubmitting?'Wird eingereicht…':'Tausch beantragen'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Inline Ändern-Formular */}
                    {isAendernOpen&&(
                      <div className="border border-orange-200 rounded-xl p-4 bg-orange-50/40 mt-1 space-y-3">
                        <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                          Änderungsanfrage für {WEEKDAY_SHORT[day.dow]} {day.d}. {MONTHS_SHORT[day.monthIdx]} ({code})
                        </p>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-gray-500">Gewünschter neuer Eintrag (optional)</span>
                          <select value={aendernNewCode} onChange={e=>setAendernNewCode(e.target.value)}
                            className="input text-sm py-1.5 h-9">
                            <option value="">— Kein Eintrag (Absage) —</option>
                            {ALL_CODES.filter(c=>c!==code).map(c=>(
                              <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-gray-500">Notiz / Begründung (optional)</span>
                          <textarea value={aendernNote} onChange={e=>setAendernNote(e.target.value)}
                            rows={2} placeholder="z.B. Krank, familiäre Gründe…"
                            className="input text-sm py-1.5 resize-none"/>
                        </label>

                        <div className="flex gap-2 pt-1">
                          <button onClick={()=>setAendernDay(null)}
                            className="flex-1 py-2 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                            Abbrechen
                          </button>
                          <button onClick={handleAendern} disabled={aendernSubmitting}
                            className="flex-1 py-2 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-40 transition-colors font-semibold">
                            {aendernSubmitting?'Wird eingereicht…':'Anfrage senden'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Archive — past Einsätze */}
              {userPersonName&&myPastEinsatzDays.length>0&&(
                <div className="pt-1">
                  <button onClick={()=>setEinsatzArchiveOpen(o=>!o)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                    <span>🗂 Archiv ({myPastEinsatzDays.length})</span>
                    <span className="text-gray-400">{einsatzArchiveOpen?'▲':'▼'}</span>
                  </button>
                  {einsatzArchiveOpen&&(
                    <div className="space-y-1 mt-2">
                      {myPastEinsatzDays.map(day=>{
                        const code=liveData.schedule[userPersonName]?.[day.key]??''
                        const planComment=(liveData as any).comments?.[userPersonName]?.[day.key]??''
                        return(
                          <div key={day.key} className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-2 bg-gray-50/60 opacity-70">
                            <div className="flex items-center gap-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${CODE_STYLE[code]??'bg-gray-100 text-gray-700'}`}>{code}</span>
                              <span className="text-sm text-gray-600">{WEEKDAY_SHORT[day.dow]} {day.d}. {MONTHS_SHORT[day.monthIdx]}</span>
                            </div>
                            {planComment&&<span className="text-xs text-gray-400 truncate max-w-[120px]">{planComment}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Meine Abwesenheiten ── */}
          {tab==='abwesenheiten'&&(
            <div className="space-y-2">
              {!userPersonName&&(
                <div className="text-center text-gray-400 py-8 text-sm">
                  Ihr Name wurde in der Planung nicht gefunden.<br/>
                  <span className="text-xs">Bitte den Administrator informieren.</span>
                </div>
              )}
              {userPersonName&&myAbwesenheitDays.length===0&&myPastAbwesenheitDays.length===0&&(
                <p className="text-center text-gray-400 py-8 text-sm">Keine Abwesenheiten eingetragen.</p>
              )}
              {(()=>{
                // Helper: find ferien request covering a given date
                const reqForDay=(date:string)=>liveRequests.find(r=>
                  r.type==='ferien'&&r.status!=='withdrawn'&&r.status!=='rejected'&&!r.adminArchived
                  &&(r.fromDate??'')<=date&&date<=(r.toDate??'')
                )
                const renderDay=(day:DayInfo,isPast=false)=>{
                  const code=liveData.schedule[userPersonName]?.[day.key]??''
                  const planComment=(liveData as any).comments?.[userPersonName]?.[day.key]??''
                  const req=reqForDay(day.key)
                  const ft=FERIEN_TYPES.find(t=>t.code===code)
                  const isStornConfirm=stornierenId===(`day-${day.key}`)
                  const isHighlighted=req?.id===highlightRequestId
                  const borderCls=
                    req?.status==='approved'  ?'border-green-200 bg-green-50/20':
                    req?.status==='pending'   ?'border-amber-200 bg-amber-50/30':
                    req?.status==='provisional'?'border-yellow-200 bg-yellow-50/30':
                    req?.status==='adjustment'?'border-orange-200 bg-orange-50/30':
                    isPast                    ?'border-gray-100 bg-gray-50/60':
                                               'border-gray-200 bg-white'
                  return(
                    <div key={day.key} id={req?`req-${req.id}`:undefined}
                      className={`border rounded-xl px-4 py-2.5 space-y-1.5 transition-all ${isHighlighted?'ring-2 ring-purple-400 ring-offset-1':''} ${borderCls} ${isPast?'opacity-70':''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${CODE_STYLE[code]??'bg-gray-100 text-gray-700'}`}>{code}</span>
                          <div>
                            {ft&&<p className="text-xs font-medium text-gray-600">{ft.emoji} {ft.label}</p>}
                            <p className="text-sm text-gray-800">{WEEKDAY_SHORT[day.dow]} {day.d}. {MONTHS_SHORT[day.monthIdx]}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {req?statusLabel(req.status):<span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">Im Plan</span>}
                        </div>
                      </div>
                      {req?.adminNote&&(
                        <p className={`text-xs rounded px-2 py-1 ${req.status==='adjustment'?'bg-orange-50 text-orange-700 border border-orange-200':'text-gray-400 italic'}`}>
                          💬 {req.adminNote}
                        </p>
                      )}
                      {!isPast&&(req?(isStornConfirm?(
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                          <p className="text-xs text-red-700 font-medium">Abwesenheit wirklich stornieren? Die Einträge werden aus dem Plan entfernt.</p>
                          <div className="flex gap-2">
                            <button onClick={()=>setStornierenId(null)}
                              className="flex-1 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                              Abbrechen
                            </button>
                            <button onClick={()=>handleStornieren(req)} disabled={stornierenSubmitting}
                              className="flex-1 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors font-semibold">
                              {stornierenSubmitting?'Wird storniert…':'Ja, stornieren'}
                            </button>
                          </div>
                        </div>
                      ):(req.status!=='withdrawn'&&(
                        <div className="flex gap-2">
                          <button onClick={()=>handleAendernAbwesenheit(req)}
                            className="flex-1 py-1 text-xs border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-medium">
                            ✎ Ändern
                          </button>
                          <button onClick={()=>setStornierenId(`day-${day.key}`)}
                            className="flex-1 py-1 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium">
                            ✕ Stornieren
                          </button>
                        </div>
                      ))):(
                        // Directly entered (no request) — offer Ändern to open ferien form pre-filled
                        <button onClick={()=>{
                          const sched=liveData.schedule[userPersonName]??{}
                          const keys=yearDays.map(d=>d.key)
                          const idx=keys.indexOf(day.key)
                          let from=day.key,to=day.key
                          for(let i=idx-1;i>=0;i--){const k=keys[i];if(FERIEN_CODES.has(sched[k]??''))from=k;else break}
                          for(let i=idx+1;i<keys.length;i++){const k=keys[i];if(FERIEN_CODES.has(sched[k]??''))to=k;else break}
                          setInlineEditFerien(undefined)
                          setFromDate(from);setToDate(to)
                          setFerienNote('')
                          setFerienType((ft?.value as FerienType)??'ferien')
                          setTab('ferien')
                        }}
                          className="w-full py-1 text-xs border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-medium">
                          ✎ Änderungsantrag stellen
                        </button>
                      ))}
                    </div>
                  )
                }
                return(<>
                  {myAbwesenheitDays.map(d=>renderDay(d,false))}
                  {myPastAbwesenheitDays.length>0&&(
                    <div className="pt-1">
                      <button onClick={()=>setAbwesenheitArchiveOpen(o=>!o)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                        <span>🗂 Archiv ({myPastAbwesenheitDays.length})</span>
                        <span className="text-gray-400">{abwesenheitArchiveOpen?'▲':'▼'}</span>
                      </button>
                      {abwesenheitArchiveOpen&&(
                        <div className="space-y-1 mt-2">
                          {myPastAbwesenheitDays.map(d=>renderDay(d,true))}
                        </div>
                      )}
                    </div>
                  )}
                </>)
              })()}
            </div>
          )}

          {/* ── Meine Anträge ── */}
          {tab==='antraege'&&(()=>{
            // Helper: is a request fully in the past?
            const isPast=(r:PlanungRequest)=>{
              if(r.type==='ferien') return (r.toDate??'')  < TODAY
              if(r.type==='absage') return (r.myDate??'')  < TODAY
              if(r.type==='tausch') return (r.myDate??'')  < TODAY
              if(r.type==='eintrag') return (r.dates??[]).length>0&&(r.dates??[]).every(d=>d<TODAY)
              return false
            }
            // Helper: format "2026-04-15" → "Mi 15. Apr"
            const fd=(s:string)=>{
              if(!s)return s
              const d=new Date(s+'T00:00:00')
              return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`
            }
            // Helper: count calendar days in ferien range
            const dayCount=(from:string,to:string)=>{
              if(!from||!to)return 0
              return Math.round((new Date(to).getTime()-new Date(from).getTime())/86400000)+1
            }

            const all=liveRequests
            const visible=all.filter(r=>!(r.status==='approved'&&isPast(r)))
            const hiddenCount=all.length-visible.length

            return(
            <div className="space-y-2">
              {visible.length===0&&(
                <p className="text-center text-gray-400 py-8 text-sm">Noch keine Anträge vorhanden</p>
              )}
              {visible.map(r=>{
                const isUnread=r.readByUser===false
                const borderCls=
                  isUnread&&r.status==='adjustment'  ?'border-orange-300 bg-orange-50/60':
                  isUnread&&r.status==='provisional' ?'border-yellow-300 bg-yellow-50/40':
                  isUnread&&r.status==='rejected'    ?'border-red-300 bg-red-50/30':
                  isUnread&&r.status==='approved'    ?'border-green-300 bg-green-50/30':
                  r.status==='adjustment'            ?'border-orange-300 bg-orange-50/40':
                  r.status==='approved'              ?'border-green-200 bg-green-50/20':
                  r.status==='rejected'              ?'border-red-200 bg-red-50/10':
                                                      'border-gray-200'
                const isHighlighted=r.id===highlightRequestId
                const typePill=(
                  <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded
                    ${r.type==='ferien'?'bg-slate-100 text-slate-700':r.type==='absage'?'bg-red-100 text-red-700':r.type==='tausch'?'bg-teal-100 text-teal-700':'bg-blue-100 text-blue-700'}`}>
                    {r.type==='ferien'?'Abwesenheit':r.type==='absage'?'Absage / Änderung':r.type==='tausch'?'Einsatztausch':'Einsatz'}
                  </span>
                )
                return(
                <div id={`req-${r.id}`} key={r.id}
                  className={`border rounded-xl p-3.5 space-y-2 transition-all ${isHighlighted?'ring-2 ring-purple-400 ring-offset-1':''} ${borderCls}`}>

                  {/* Row 1: type pill + unread dot + status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {isUnread&&<span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>}
                      {typePill}
                    </div>
                    {statusLabel(r.status)}
                  </div>

                  {/* Row 2: details per type */}
                  {r.type==='ferien'&&(()=>{
                    const ft=FERIEN_TYPES.find(t=>t.value===(r.ferienType??'ferien'))??FERIEN_TYPES[0]
                    const days=dayCount(r.fromDate??'',r.toDate??'')
                    return(
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-500">{ft.emoji} {ft.label}</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-medium text-gray-800">
                          {fd(r.fromDate??'')} – {fd(r.toDate??'')}
                        </p>
                        {days>0&&<span className="text-xs text-gray-400">{days} Tag{days!==1?'e':''}</span>}
                      </div>
                      {r.note&&<p className="text-xs text-gray-500 italic">„{r.note}"</p>}
                    </div>
                  )})()}

                  {r.type==='absage'&&(
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CODE_STYLE[r.myCode??'']??'bg-gray-100 text-gray-700'}`}>{r.myCode}</span>
                        <span className="text-sm font-medium text-gray-800">{fd(r.myDate??'')}</span>
                        {(r as any).newCode&&<>
                          <span className="text-xs text-gray-400">→</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CODE_STYLE[(r as any).newCode]??'bg-gray-100 text-gray-700'}`}>{(r as any).newCode}</span>
                          <span className="text-xs text-gray-500">{CODE_LABELS[(r as any).newCode]??''}</span>
                        </>}
                        {!(r as any).newCode&&<span className="text-xs text-gray-400 italic">→ Absage</span>}
                      </div>
                      {(r as any).note&&<p className="text-xs text-gray-500 italic">„{(r as any).note}"</p>}
                    </div>
                  )}

                  {r.type==='tausch'&&(
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CODE_STYLE[r.myCode??'']??'bg-gray-100 text-gray-700'}`}>{r.myCode}</span>
                        <span className="text-sm font-medium text-gray-800">{fd(r.myDate??'')}</span>
                        <span className="text-gray-400 font-bold">⇄</span>
                        {r.theirPerson?(
                          <>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CODE_STYLE[r.theirCode??'']??'bg-gray-100 text-gray-700'}`}>{r.theirCode||'?'}</span>
                            <span className="text-sm font-medium text-gray-800">{fd(r.theirDate??'')}</span>
                            <span className="text-xs text-gray-500">mit {r.theirPerson}</span>
                          </>
                        ):(
                          <>
                            <span className="text-sm font-medium text-gray-800">{fd(r.theirDate??'')}</span>
                            <span className="text-xs text-gray-400 italic">(Wunschdatum)</span>
                          </>
                        )}
                      </div>
                      {(r as any).note&&<p className="text-xs text-gray-500 italic">„{(r as any).note}"</p>}
                    </div>
                  )}

                  {r.type==='eintrag'&&(
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CODE_STYLE[r.code??'']??'bg-gray-100 text-gray-700'}`}>{r.code}</span>
                        <span className="text-xs font-semibold text-gray-600">{CODE_LABELS[r.code??'']??''}</span>
                        {(r as any).section&&<span className="text-xs text-gray-400">· {(r as any).section}</span>}
                      </div>
                      {r.dates&&r.dates.length>0&&(
                        <p className="text-sm text-gray-700">
                          {r.dates.map(d=>fd(d)).join(', ')}
                        </p>
                      )}
                      {r.note&&<p className="text-xs text-gray-500 italic">„{r.note}"</p>}
                    </div>
                  )}

                  {/* Row 3: timeline */}
                  <div className="flex flex-col gap-0.5 pt-0.5 border-t border-gray-100">
                    {fmtTs(r.createdAt)&&(
                      <span className="text-xs text-gray-400">📅 Eingereicht: {fmtTs(r.createdAt)}</span>
                    )}
                    {(r as any).actionBy&&(r as any).actionAt&&(
                      <span className="text-xs text-gray-500">
                        {r.status==='approved'?'✓ Genehmigt':r.status==='rejected'?'✕ Abgelehnt':r.status==='adjustment'?'↩ Anpassung':r.status==='provisional'?'◑ Provisorisch':''} von <strong>{(r as any).actionBy}</strong> · {fmtTs((r as any).actionAt)}
                      </span>
                    )}
                  </div>

                  {/* Admin note */}
                  {r.adminNote&&(
                    <p className={`text-xs rounded px-2 py-1.5 ${r.status==='adjustment'?'bg-orange-50 text-orange-700 border border-orange-200':'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                      💬 {r.adminNote}
                    </p>
                  )}

                  {/* Adjustment button */}
                  {r.status==='adjustment'&&(
                    <button
                      onClick={()=>{
                        if(r.type==='ferien'){
                          setInlineEditFerien({
                            id:r.id!,fromDate:r.fromDate,toDate:r.toDate,
                            note:r.note,ferienType:r.ferienType as FerienType|undefined,
                            adjustmentSuggestions:(r as any).adjustmentSuggestions
                          })
                          setFromDate(r.fromDate??'')
                          setToDate(r.toDate??'')
                          setFerienNote(r.note??'')
                          setFerienType((r.ferienType as FerienType|undefined)??'ferien')
                          setTab('ferien')
                        } else if(r.type==='eintrag'){
                          onClose()
                          navigate('/planung',{state:{editRequest:{id:r.id,dates:r.dates,code:r.code,username:r.username}}})
                        } else {
                          setTab('einsaetze')
                        }
                      }}
                      className="w-full text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold">
                      ✏️ Antrag anpassen
                    </button>
                  )}
                </div>
              )})}

              {/* Hidden past-approved hint */}
              {hiddenCount>0&&(
                <p className="text-center text-xs text-gray-400 pt-1">
                  {hiddenCount} vergangene genehmigte Antrag{hiddenCount!==1?'anträge':' ausgeblendet'} ausgeblendet
                </p>
              )}
            </div>
          )})()}
        </div>
      </div>
    </div>
  )
}

function loadYearListLocal():number[]{
  try{const s=localStorage.getItem(YEARS_KEY);if(s)return JSON.parse(s)}catch{}
  return DEFAULT_YEARS
}

type ViewMode='month'|'year'|'arbeitstage'

export default function EinsatzplanungPage(){
  const { canEditPlanung, profile, isAdmin, isArzt, isGeschaeftsleitung, isGuest } = useAuth()
  const isReadOnly = !canEditPlanung
  const toast = useToast()
  const browserCtx = useBrowser()
  const today=new Date()
  const [yearList,setYearListRaw]=useState<number[]>(loadYearListLocal)
  const setYearList=(list:number[])=>{setYearListRaw(list);saveYearListFirestore(list)}
  const [year,setYear]=useState(()=>{
    const y=today.getFullYear()
    const list=loadYearListLocal()
    return list.includes(y)?y:list[list.length-1]??y
  })
  const [month,setMonth]=useState(today.getMonth())
  const [view,setView]=useState<ViewMode>('month')
  const [scrollToToday,setScrollToToday]=useState(false)

  // Live listener for yearList from Firestore
  useEffect(()=>{
    const unsub=onSnapshot(doc(db,'settings','yearList'),snap=>{
      if(!snap.exists())return
      const years=snap.data().years as number[]
      if(Array.isArray(years)&&years.length>0){
        setYearListRaw(years)
        // Also sync year if current year not in new list
        setYear(y=>years.includes(y)?y:years[years.length-1])
      }
    })
    return()=>unsub()
  },[])

  useEffect(()=>{
    if(!scrollToToday||view!=='year')return
    const timer=setTimeout(()=>{
      document.querySelector('[data-year-today]')?.scrollIntoView({behavior:'smooth',block:'center'})
      setScrollToToday(false)
    },80)
    return()=>clearTimeout(timer)
  },[scrollToToday,view,year])
  const [data,setData]=useState<PlanungData>(defaultData)
  const [isLoading,setIsLoading]=useState(true)
  const [isSaving,setIsSaving]=useState(false)
  const [popover,setPopover]=useState<Popover|null>(null)
  const [commentDraft,setCommentDraft]=useState('')
  const [multiCommentDraft,setMultiCommentDraft]=useState('')
  const [printMenu,setPrintMenu]=useState(false)
  const [addingTo,setAddingTo]=useState<string|null>(null)
  const [newName,setNewName]=useState('')
  const [hoveredPerson,setHoveredPerson]=useState<string|null>(null)
  const [hoveredCol,setHoveredCol]=useState<string|null>(null)
  const [doctorDetail,setDoctorDetail]=useState<string|null>(null)
  const location = useLocation()
  const [showOpenDays,setShowOpenDays]=useState(false)
  const [showIviVorschlag,setShowIviVorschlag]=useState(false)
  const [openDaysEditRequest,setOpenDaysEditRequest]=useState<EditRequest|undefined>(undefined)
  const [personalBereichEditFerien,setPersonalBereichEditFerien]=useState<EditFerienRequest|undefined>(undefined)
  const [personalBereichInitialTab,setPersonalBereichInitialTab]=useState<'ferien'|'einsaetze'|'abwesenheiten'|'antraege'|undefined>(undefined)
  const [personalBereichHighlightId,setPersonalBereichHighlightId]=useState<string|undefined>(undefined)

  // Open modal pre-filled if navigated here with editRequest / editFerienRequest state
  // Use location.key so it fires on every navigation, even if already on this page
  useEffect(()=>{
    const state=location.state as {editRequest?:EditRequest;editFerienRequest?:EditFerienRequest}|null
    if(state?.editRequest){
      setOpenDaysEditRequest(state.editRequest)
      setShowOpenDays(true)
      window.history.replaceState({},document.title)
    }
    if(state?.editFerienRequest){
      setPersonalBereichEditFerien(state.editFerienRequest)
      setShowPersonalBereich(true)
      window.history.replaceState({},document.title)
    }
  },[location.key])
  const [showLiris,setShowLiris]=useState(false)
  const [showPersonalBereich,setShowPersonalBereich]=useState(false)
  const [myRequests,setMyRequests]=useState<PlanungRequest[]>([])

  // Live subscription for own planungRequests — always active, not just when modal is open
  useEffect(()=>{
    if(!profile?.uid)return
    const q=query(collection(db,'planungRequests'),where('uid','==',profile.uid))
    return onSnapshot(q,snap=>{
      const sorted=snap.docs
        .map(d=>({id:d.id,...d.data()} as PlanungRequest))
        .sort((a,b)=>((b.createdAt as any)?.seconds??0)-((a.createdAt as any)?.seconds??0))
      setMyRequests(sorted)
    })
  },[profile?.uid])
  const [showEinsatztausch,setShowEinsatztausch]=useState(false)
  const [multiSel,setMultiSel]=useState<Set<string>>(new Set())
  const isDragging=useRef(false)
  const dragMoved=useRef(false)
  const dragStartKey=useRef<string|null>(null)
  const popoverRef=useRef<HTMLDivElement>(null)
  const printMenuRef=useRef<HTMLDivElement>(null)
  const saveTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null)
  const isFirstLoad=useRef(true)
  const isExternalUpdate=useRef(false)
  // Captures data at the moment the debounce timer is scheduled, so the timer callback
  // saves the correct local state even if setData() is later called by an external snapshot.
  const pendingSaveData=useRef<PlanungData|null>(null)

  const feiertage=getFeiertage(year)
  const monthDays=getMonthDays(year,month,feiertage)
  const yearDays=getYearDays(year,feiertage)

  // Live listener — updates in real-time when any user saves
  useEffect(()=>{
    setIsLoading(true)
    isFirstLoad.current=true
    const unsub=onSnapshot(
      doc(db,'planung',String(year)),
      {includeMetadataChanges:true},
      snap=>{
        // Skip own pending writes (local cache echo) — wait for server confirmation
        if(snap.metadata.hasPendingWrites)return
        if(!snap.exists()){
          if(year===2026){
            setData(defaultData())
            isFirstLoad.current=false
            setIsLoading(false)
          } else {
            // Load previous year to carry over active persons only
            loadPlanung(year-1).then(prev=>{
              if(prev){
                const inactive=new Set(prev.inactive??[])
                const sections=prev.sections.map(s=>({...s,persons:s.persons.filter(p=>!inactive.has(p))}))
                setData({sections,schedule:{}})
              } else {
                setData({sections:SECTIONS_2026.map(s=>({...s,persons:[...s.persons]})),schedule:{}})
              }
              isFirstLoad.current=false
              setIsLoading(false)
            })
          }
          return
        }
        // Mark as external so the save debounce skips the setData() call below.
        // Do NOT cancel the debounce timer here: if the user made a local change within the
        // last 800 ms, the pending timer must still fire to persist it.  Cancelling it here
        // was the root cause of "entries not saved" — the server confirmation for a previous
        // save arrived before the debounce fired and silently discarded the new local change.
        isExternalUpdate.current=true
        const loaded=snap.data() as PlanungData
        // Migrate: inject GL section if missing (between Augenärzte and Mitarbeiter)
        if(!loaded.sections.some(s=>s.label==='Geschäftsleitung')){
          const idx=loaded.sections.findIndex(s=>s.label==='Augenärzte SU')
          loaded.sections.splice(idx>=0?idx+1:loaded.sections.length,0,{label:'Geschäftsleitung',persons:[]})
        }
        setData(loaded)
        setIsLoading(false)
      }
    )
    return()=>unsub()
  },[year])

  // Debounced save to Firestore on every data change (skip first load + external updates)
  useEffect(()=>{
    if(isLoading)return
    if(isFirstLoad.current){isFirstLoad.current=false;return}
    if(isExternalUpdate.current){isExternalUpdate.current=false;return}
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current)
    // Capture current data into a ref so the timer callback always saves *this* snapshot,
    // even if an incoming Firestore confirmation calls setData() before the timer fires.
    pendingSaveData.current=data
    saveTimerRef.current=setTimeout(()=>{
      const toSave=pendingSaveData.current
      pendingSaveData.current=null
      if(!toSave)return
      setIsSaving(true)
      savePlanung(year,toSave).finally(()=>setTimeout(()=>setIsSaving(false),600))
    },800)
    // Cleanup cancels the timer on local-change re-renders (isExternalUpdate=false),
    // but leaves it running when an external snapshot triggers the re-render.
    return()=>{if(!isExternalUpdate.current&&saveTimerRef.current)clearTimeout(saveTimerRef.current)}
  },[year,data,isLoading])

  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(popoverRef.current&&!popoverRef.current.contains(e.target as Node))setPopover(null)
    }
    document.addEventListener('mousedown',h)
    return()=>document.removeEventListener('mousedown',h)
  },[popover])

  const setCode=useCallback((person:string,date:string,code:Code|null)=>{
    setData(prev=>{
      const schedule={...prev.schedule},ps={...(schedule[person]??{})}
      if(code===null)delete ps[date];else ps[date]=code
      schedule[person]=ps
      // Kommentar mitlöschen wenn Eintrag entfernt wird
      if(code===null){
        const comments={...(prev.comments??{})},pc={...(comments[person]??{})}
        delete pc[date];comments[person]=pc
        return{...prev,schedule,comments}
      }
      return{...prev,schedule}
    });setPopover(null)
  },[])

  const setComment=useCallback((person:string,date:string,comment:string)=>{
    setData(prev=>{
      const comments={...(prev.comments??{})},pc={...(comments[person]??{})}
      if(comment.trim())pc[date]=comment.trim();else delete pc[date]
      comments[person]=pc;return{...prev,comments}
    })
  },[])

  const setPensum=useCallback((person:string,val:number|null)=>{
    setData(prev=>{
      const pensum={...(prev.pensum??{})}
      if(val===null||isNaN(val))delete pensum[person];else pensum[person]=val
      return{...prev,pensum}
    })
  },[])

  const reorderPersons=useCallback((sectionLabel:string,persons:string[])=>{
    // Removed: savePlanung() called inside setData() — React may invoke setState callbacks
    // multiple times in Strict Mode, and it raced against the debounced save useEffect.
    // The debounce handles persistence within 800 ms.
    setData(prev=>({...prev,sections:prev.sections.map(s=>s.label===sectionLabel?{...s,persons}:s)}))
  },[])

  const toggleInactive=useCallback((person:string)=>{
    setData(prev=>{
      const inactive=[...(prev.inactive??[])]
      const idx=inactive.indexOf(person)
      if(idx>=0)inactive.splice(idx,1);else inactive.push(person)
      return{...prev,inactive}
    })
  },[])

  const addPerson=(sectionLabel:string)=>{
    const name=newName.trim();if(!name)return
    setData(prev=>({...prev,sections:prev.sections.map(s=>s.label===sectionLabel?{...s,persons:[...s.persons,name]}:s)}))
    setNewName('');setAddingTo(null)
  }
  const assignDays=useCallback((person:string,days:string[],code:Code)=>{
    setData(prev=>{
      const schedule={...prev.schedule},ps={...(schedule[person]??{})}
      days.forEach(d=>{ps[d]=code})
      schedule[person]=ps;return{...prev,schedule}
    })
  },[])

  const removePerson=(sectionLabel:string,person:string)=>{
    setData(prev=>{const schedule={...prev.schedule};delete schedule[person];return{...prev,sections:prev.sections.map(s=>s.label===sectionLabel?{...s,persons:s.persons.filter(p=>p!==person)}:s),schedule}})
  }
  const renamePerson=(sectionLabel:string,oldName:string,newName:string)=>{
    setData(prev=>{
      const schedule={...prev.schedule}
      if(schedule[oldName]){schedule[newName]=schedule[oldName];delete schedule[oldName]}
      return{...prev,sections:prev.sections.map(s=>s.label===sectionLabel?{...s,persons:s.persons.map(p=>p===oldName?newName:p)}:s),schedule}
    })
  }

  // Registered users for rename dropdown (fetch all, filter in JS to avoid index requirement)
  const [userNames,setUserNames]=useState<string[]>([])
  const [arztProfiles,setArztProfiles]=useState<UserProfile[]>([])
  useEffect(()=>{
    getDocs(collection(db,'users'))
      .then(snap=>{
        const all=snap.docs.map(d=>d.data() as UserProfile)
        const names=all
          .filter(u=>u.status==='approved'&&(u.displayName||u.username))
          .map(u=>(u.displayName||u.username) as string)
          .sort((a,b)=>a.localeCompare(b,'de'))
        setUserNames(names)
        const aerzte=all
          .filter(u=>u.status==='approved'&&(u.role==='arzt'||u.additionalRoles?.includes('arzt')))
          .sort((a,b)=>(a.displayName||a.username).localeCompare(b.displayName||b.username,'de'))
        setArztProfiles(aerzte)
      }).catch(()=>{})
  },[])
  const handleCellClick=(e:React.MouseEvent,person:string,date:string)=>{
    if(isReadOnly)return
    if(dragMoved.current){dragMoved.current=false;return}
    if(multiSel.size>0){
      // Im Mehrfachauswahl-Modus: Zelle per Einzelklick ein-/ausschalten
      const key=`${person}::${date}`
      setMultiSel(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n})
    }
  }

  const handleCellDoubleClick=(e:React.MouseEvent,person:string,date:string)=>{
    if(multiSel.size>0)return
    // Own cell — open Mein Bereich at the relevant request instead of code editor
    const myName=data.sections.flatMap(s=>s.persons).find(p=>p===profile?.displayName||p===profile?.username)
    if(profile&&!isGuest&&!isAdmin&&myName&&person===myName){
      // Find matching request for this date
      const FERIEN_CODES_SET=new Set(['OP','W','Fer','K','A','AG'])
      const cellCode=data.schedule[person]?.[date]??''
      const req=myRequests.find(r=>{
        if(r.status==='withdrawn'||r.status==='rejected')return false
        if(r.type==='ferien')return r.fromDate&&r.toDate&&date>=r.fromDate&&date<=r.toDate
        if(r.type==='eintrag')return r.dates?.includes(date)
        if(r.type==='absage')return r.myDate===date
        if(r.type==='tausch')return r.myDate===date||r.theirDate===date
        return false
      })
      if(req?.type==='ferien'){
        // Ferien request found → open edit form directly
        setPersonalBereichEditFerien({
          id:req.id!,fromDate:req.fromDate,toDate:req.toDate,
          note:req.note,ferienType:req.ferienType as FerienType|undefined,
          adjustmentSuggestions:(req as any).adjustmentSuggestions,
        })
        setPersonalBereichInitialTab('ferien')
        setPersonalBereichHighlightId(undefined)
      } else if(!req&&FERIEN_CODES_SET.has(cellCode)){
        // Direct plan entry (no request) → pre-fill form with contiguous date range
        const sched=data.schedule[person]??{}
        const sortedKeys=yearDays.map(d=>d.key)
        const idx=sortedKeys.indexOf(date)
        let from=date,to=date
        for(let i=idx-1;i>=0;i--){const k=sortedKeys[i];if(FERIEN_CODES_SET.has(sched[k]??''))from=k;else break}
        for(let i=idx+1;i<sortedKeys.length;i++){const k=sortedKeys[i];if(FERIEN_CODES_SET.has(sched[k]??''))to=k;else break}
        const ft=FERIEN_TYPES.find(t=>t.code===cellCode)?.value as FerienType|undefined
        // Empty id → handleFerien treats as new request (pre-fill only)
        setPersonalBereichEditFerien({id:'',fromDate:from,toDate:to,ferienType:ft??'ferien'} as any)
        setPersonalBereichInitialTab('ferien')
        setPersonalBereichHighlightId(undefined)
      } else if(req){
        // Non-ferien request → route by current cell code (absage may have changed code to absence)
        setPersonalBereichInitialTab(FERIEN_CODES_SET.has(cellCode)?'abwesenheiten':'einsaetze')
        setPersonalBereichHighlightId(undefined)
        setPersonalBereichEditFerien(undefined)
      } else if(!FERIEN_CODES_SET.has(cellCode)&&cellCode){
        // Plain Einsatz cell (no request) → open Einsätze tab
        setPersonalBereichInitialTab('einsaetze')
        setPersonalBereichHighlightId(undefined)
        setPersonalBereichEditFerien(undefined)
      } else {
        setPersonalBereichInitialTab(undefined)
        setPersonalBereichHighlightId(undefined)
        setPersonalBereichEditFerien(undefined)
      }
      setShowPersonalBereich(true)
      return
    }
    if(isReadOnly)return
    const rect=(e.currentTarget as HTMLElement).getBoundingClientRect()
    setCommentDraft(data.comments?.[person]?.[date]??'')
    setPopover({person,date,x:rect.left,y:rect.bottom+4})
  }

  const handleCellMouseDown=(person:string,date:string)=>{
    if(isReadOnly)return
    isDragging.current=true
    dragMoved.current=false
    dragStartKey.current=`${person}::${date}`
  }

  const handleCellMouseEnter=(person:string,date:string)=>{
    if(!isDragging.current||isReadOnly)return
    const key=`${person}::${date}`
    if(key===dragStartKey.current)return
    if(!dragMoved.current){
      dragMoved.current=true
      setMultiSel(prev=>{const n=new Set(prev);n.add(dragStartKey.current!);n.add(key);return n})
    } else {
      setMultiSel(prev=>{if(prev.has(key))return prev;const n=new Set(prev);n.add(key);return n})
    }
  }

  useEffect(()=>{
    const onUp=()=>{isDragging.current=false}
    document.addEventListener('mouseup',onUp)
    return()=>document.removeEventListener('mouseup',onUp)
  },[])

  const applyMultiSel=(code:Code|null)=>{
    setData(prev=>{
      const schedule={...prev.schedule}
      multiSel.forEach(key=>{
        const [person,date]=key.split('::')
        const ps={...(schedule[person]??{})}
        if(code===null)delete ps[date];else ps[date]=code
        schedule[person]=ps
      })
      return{...prev,schedule}
    })
    setMultiSel(new Set())
  }

  // Nur Feiertage des AKTUELLEN Monats — monthDays enthält auch Randtage aus
  // dem Vor-/Folgemonat (Wochen-Auffüllung). Ohne isCurrentMonth-Filter zeigte
  // die Fusszeile z.B. in der Juli-Ansicht den 1. August (Nat) fälschlich als
  // "1. Jul" an (Tageszahl 1 + Ansichtsmonat).
  const ftThisMonth=monthDays.filter(d=>d.ftName&&d.isCurrentMonth)

  return(
    <div className={`flex flex-col p-3 sm:p-4 gap-3 ${view==='month'?'h-full overflow-hidden':'min-h-full'}`} data-view={view}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Einsatzplanung Suhr</h1>
            {/* Liris-Panel ein-/ausklappen (nur Desktop-App; Panel wird in
                AppShell auch auf /planung gemountet). Bewusst neben dem Titel
                mit relative/z-20 — in der Controls-Zeile rechts war der Button
                auf manchen Setups nicht klickbar (überlagert). */}
            {!!(window as any).electronApp && (
              <button type="button"
                onClick={()=>browserCtx.toggle()}
                title="Liris-Ansicht ein-/ausblenden"
                className={`relative z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  browserCtx.isOpen ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                <Globe className="w-3.5 h-3.5" /> Liris
              </button>
            )}
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {isReadOnly?'👁 Nur-Lese-Ansicht':isLoading?'Wird geladen…':isSaving?'☁️ Speichern…':'Zelle antippen zum Bearbeiten'}
          </p>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto">


          {/* Year + add/delete */}
          <div className="flex items-center gap-1">
            <select value={year}
              onChange={e=>{
                const val=e.target.value
                if(val==='__add__'){
                  if(!isAdmin&&!isGeschaeftsleitung)return
                  const max=Math.max(...yearList),next=max+1
                  setYearList([...yearList,next].sort((a,b)=>a-b));setYear(next);setMonth(0)
                } else {
                  setYear(Number(val));setMonth(0)
                }
              }}
              className="input text-sm py-1.5 pr-8 h-9">
              {yearList.map(y=><option key={y} value={y}>{y}</option>)}
              {(isAdmin||isGeschaeftsleitung)&&<option disabled>──────────</option>}
              {(isAdmin||isGeschaeftsleitung)&&<option value="__add__">+ {Math.max(...yearList)+1} hinzufügen</option>}
            </select>
            {(isAdmin||isGeschaeftsleitung)&&year<today.getFullYear()&&yearList.length>1&&(
              <button
                onClick={()=>{
                  if(!confirm(`Jahr ${year} wirklich löschen?`))return
                  const next=yearList.filter(y=>y!==year)
                  setYearList(next);setYear(next[next.length-1])
                }}
                title={`Jahr ${year} entfernen`}
                className="h-9 px-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-semibold transition-colors">
                ×
              </button>
            )}
            {view==='year'&&(
              <button onClick={()=>{
                  if(year!==today.getFullYear()&&yearList.includes(today.getFullYear()))setYear(today.getFullYear())
                  setScrollToToday(true)
                }}
                className="h-9 px-2.5 rounded-lg text-xs font-medium bg-primary-50 text-primary-600 border border-primary-200 hover:bg-primary-100 transition-colors">
                Heute
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5 text-sm">
            <button onClick={()=>setView('month')} title="Monat" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-medium transition-all ${view==='month'?'bg-white text-primary-700 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
              <Calendar className="w-4 h-4"/><span className="hidden sm:inline">Monat</span>
            </button>
            <button onClick={()=>setView('year')} title="Jahr" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-medium transition-all ${view==='year'?'bg-white text-primary-700 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
              <CalendarDays className="w-4 h-4"/><span className="hidden sm:inline">Jahr</span>
            </button>
            <button onClick={()=>setView('arbeitstage')} title="Arbeitstage" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-medium transition-all ${view==='arbeitstage'?'bg-white text-primary-700 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
              <User className="w-4 h-4"/><span className="hidden sm:inline">Arbeitstage</span>
            </button>
          </div>

          {/* Month nav */}
          {view==='month'&&(
            <div className="flex items-center gap-0.5">
              <button onClick={()=>setMonth(m=>Math.max(0,m-1))} disabled={month===0} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronLeft className="w-4 h-4 text-gray-600"/></button>
              <span className="w-24 sm:w-28 text-center font-semibold text-gray-800 text-sm">{MONTHS[month]} {year}</span>
              <button onClick={()=>setMonth(m=>Math.min(11,m+1))} disabled={month===11} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronRight className="w-4 h-4 text-gray-600"/></button>
              {(month!==today.getMonth()||year!==today.getFullYear())&&(
                <button onClick={()=>{setYear(today.getFullYear());setMonth(today.getMonth())}}
                  className="ml-1 h-9 px-2.5 rounded-lg text-xs font-medium bg-primary-50 text-primary-600 border border-primary-200 hover:bg-primary-100 transition-colors">
                  Heute
                </button>
              )}
            </div>
          )}

          {/* Offene Tage — nur für Ärzte und Admins */}
          {(isAdmin||isArzt||isGeschaeftsleitung)&&<button onClick={()=>setShowOpenDays(true)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-orange-200 bg-orange-50 text-xs sm:text-sm text-orange-700 hover:bg-orange-100 transition-colors font-medium">
            <CalendarDays className="w-4 h-4 shrink-0"/>
            <span className="hidden sm:inline">Offene Tage</span>
          </button>}

          {/* IVI-Tage vorschlagen — nur für Ärzte und Admins */}
          {(isAdmin||isArzt||isGeschaeftsleitung)&&<button onClick={()=>setShowIviVorschlag(true)}
            title="Schlägt im 14-Tage-Raster IVI-Tage vor und zeigt, was noch fehlt"
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-teal-200 bg-teal-50 text-xs sm:text-sm text-teal-700 hover:bg-teal-100 transition-colors font-medium">
            <Calendar className="w-4 h-4 shrink-0"/>
            <span className="hidden sm:inline">IVI-Tage</span>
          </button>}

          {/* Mein Bereich */}
          {profile&&!isGuest&&<button onClick={()=>setShowPersonalBereich(true)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-purple-200 bg-purple-50 text-xs sm:text-sm text-purple-700 hover:bg-purple-100 transition-colors font-medium">
            <User className="w-4 h-4 shrink-0"/>
            <span className="hidden sm:inline">Mein Bereich</span>
          </button>}


          {/* Alter deaktivierter Liris-Platzhalter entfernt (2026-07-19) — das
              funktionierende Liris-Panel öffnet der Button neben dem Titel. */}

          {/* Print */}
          <button onClick={()=>setPrintMenu(v=>!v)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-200 text-xs sm:text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer className="w-4 h-4 shrink-0"/>
            <span className="hidden sm:inline">Drucken</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`card overflow-hidden flex flex-col ${view==='month'?'flex-1 min-h-0':''}`}>
        {isLoading?(
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mr-3"/>
            Lade Daten…
          </div>
        ):view==='arbeitstage'?(
          <div className="overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 w-40">Arzt/Ärztin</th>
                  {(['Mo','Di','Mi','Do','Fr','Sa'] as const).map(d=>(
                    <th key={d} className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-36">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {arztProfiles.length===0?(
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Keine Ärzte mit eingetragener Arbeitszeit gefunden.</td></tr>
                ):arztProfiles.map(u=>{
                  const az=u.arbeitszeit??{}
                  const days: {key:'mo'|'di'|'mi'|'do'|'fr'|'sa';label:string}[]=[
                    {key:'mo',label:'Mo'},{key:'di',label:'Di'},{key:'mi',label:'Mi'},
                    {key:'do',label:'Do'},{key:'fr',label:'Fr'},{key:'sa',label:'Sa'},
                  ]
                  return(
                    <tr key={u.uid} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-blue-700">
                              {(u.displayName||u.username).split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join('')}
                            </span>
                          </div>
                          <span className="text-xs font-medium text-gray-800">{u.displayName||u.username}</span>
                        </div>
                      </td>
                      {days.map(({key})=>{
                        const day=az[key]
                        return(
                          <td key={key} className="px-3 py-2.5 text-center">
                            {day?(
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
                                {day.von} – {day.bis}
                              </span>
                            ):(
                              <span className="text-xs text-gray-300 italic">Frei</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ):view==='year'?(
          <YearCalendarView
            data={data}
            yearDays={yearDays}
            year={year}
            onPersonClick={setDoctorDetail}
          />
        ):(
          <div className="overflow-auto flex-1 min-h-0">
            <PlanTable
              days={monthDays}
              data={data}
              showMonthSep={false}
              hoveredPerson={hoveredPerson}
              hoveredCol={hoveredCol}
              setHoveredPerson={setHoveredPerson}
              setHoveredCol={setHoveredCol}
              onCellClick={handleCellClick}
              onCellDoubleClick={handleCellDoubleClick}
              comments={data.comments}
              onPersonClick={setDoctorDetail}
              onRemovePerson={removePerson}
              onRenamePerson={renamePerson}
              userNames={userNames}
              addingTo={addingTo}
              setAddingTo={setAddingTo}
              newName={newName}
              setNewName={setNewName}
              onAddPerson={addPerson}
              onSetPensum={setPensum}
              onToggleInactive={toggleInactive}
              onReorderPersons={reorderPersons}
              isAdmin={isAdmin}
              isGeschaeftsleitung={isGeschaeftsleitung}
              multiSel={multiSel}
              onCellMouseDown={handleCellMouseDown}
              onCellMouseEnter={handleCellMouseEnter}
            />
          </div>
        )}
      </div>

      {/* Feiertage (month view only) */}
      {view==='month'&&ftThisMonth.length>0&&(
        <div className="flex flex-wrap gap-2">
          {ftThisMonth.map(({d,ftName})=>(
            <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-orange-100 text-orange-700 font-medium">
              📅 {d}. {MONTHS_SHORT[month]} — {ftName}
            </span>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {ALL_CODES.map(code=>(
          <span key={code} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${CODE_STYLE[code]}`}>
            <span className="font-bold">{code}</span><span className="opacity-75">{CODE_LABELS[code]}</span>
          </span>
        ))}
      </div>

      {/* Multi-select floating action bar */}
      {multiSel.size>0&&(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl px-4 py-3 flex flex-col gap-2 min-w-[320px] max-w-[95vw]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-gray-700">{multiSel.size} Felder ausgewählt</span>
            <button onClick={()=>{setMultiSel(new Set());setMultiCommentDraft('')}} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Auswahl löschen</button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {ALL_CODES.map(code=>(
              <button key={code} onClick={()=>applyMultiSel(code)}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 hover:scale-105 active:scale-95 ${CODE_STYLE[code]}`}>
                <span className="font-bold text-[11px]">{code}</span>
                <span className="text-[9px] opacity-75 leading-none text-center">{CODE_LABELS[code]}</span>
              </button>
            ))}
          </div>
          <button onClick={()=>applyMultiSel(null)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
            <X className="w-3 h-3"/> Leer / Entfernen
          </button>
          <div className="pt-1 border-t border-gray-100">
            <div className="flex gap-1.5">
              <textarea
                placeholder="Kommentar für alle gewählten Felder…"
                value={multiCommentDraft}
                onChange={e=>setMultiCommentDraft(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&!e.shiftKey){
                    e.preventDefault()
                    multiSel.forEach(key=>{const[person,date]=key.split('::');setComment(person,date,multiCommentDraft)})
                    setMultiCommentDraft('')
                  }
                }}
                rows={2}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder-gray-300"
              />
              <button
                onClick={()=>{
                  multiSel.forEach(key=>{const[person,date]=key.split('::');setComment(person,date,multiCommentDraft)})
                  setMultiCommentDraft('')
                }}
                className="self-end px-2.5 py-1.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors whitespace-nowrap">
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Code picker */}
      {popover&&(
        <div ref={popoverRef}
          style={{position:'fixed',left:Math.min(popover.x,window.innerWidth-220),top:Math.min(popover.y,window.innerHeight-300),zIndex:1000}}
          className="bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-52">
          <div className="text-[10px] text-gray-400 font-medium px-1 mb-1.5">
            {new Date(popover.date).toLocaleDateString('de-CH',{weekday:'short',day:'numeric',month:'short'})}
            {feiertage[popover.date]&&<span className="ml-1 text-orange-600">· {feiertage[popover.date]}</span>}
            <div className="text-gray-600 font-semibold text-xs">{popover.person}</div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {ALL_CODES.map(code=>(
              <button key={code} onClick={()=>setCode(popover.person,popover.date,code)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80 ${CODE_STYLE[code]} ${data.schedule[popover.person]?.[popover.date]===code?'ring-2 ring-offset-1 ring-primary-500':''}`}>
                <span className="font-bold w-7">{code}</span><span className="opacity-75">{CODE_LABELS[code]}</span>
              </button>
            ))}
            <button onClick={()=>setCode(popover.person,popover.date,null)}
              className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
              <X className="w-3 h-3"/> Leer / Entfernen
            </button>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-100">
            <textarea
              placeholder="Kommentar…"
              value={commentDraft}
              onChange={e=>setCommentDraft(e.target.value)}
              onBlur={()=>setComment(popover.person,popover.date,commentDraft)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();setComment(popover.person,popover.date,commentDraft);setPopover(null)}}}
              rows={2}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder-gray-300"
            />
          </div>
        </div>
      )}

      {/* Doctor detail modal */}
      {doctorDetail&&(
        <DoctorDetailModal
          person={doctorDetail}
          data={data}
          yearDays={yearDays}
          year={year}
          onClose={()=>setDoctorDetail(null)}
        />
      )}

      {/* Open days modal */}
      {showOpenDays&&(
        <OpenDaysModal
          data={data}
          yearDays={yearDays}
          onClose={()=>{setShowOpenDays(false);setOpenDaysEditRequest(undefined)}}
          onAssign={assignDays}
          editRequest={openDaysEditRequest}
        />
      )}
      {showIviVorschlag&&(
        <IviVorschlagModal
          data={data}
          yearDays={yearDays}
          year={year}
          feiertage={feiertage}
          onClose={()=>setShowIviVorschlag(false)}
          onAssign={assignDays}
        />
      )}
      {showLiris&&(
        <LirisModal
          data={data}
          yearDays={yearDays}
          year={year}
          feiertage={feiertage}
          onClose={()=>setShowLiris(false)}
        />
      )}

      {/* Personal area modal */}
      {showPersonalBereich&&(
        <PersonalBereichModal
          onClose={()=>{setShowPersonalBereich(false);setPersonalBereichEditFerien(undefined);setPersonalBereichInitialTab(undefined);setPersonalBereichHighlightId(undefined)}}
          isAdmin={isAdmin}
          data={data}
          yearDays={yearDays}
          year={year}
          requests={myRequests}
          editFerienRequest={personalBereichEditFerien}
          initialTab={personalBereichInitialTab}
          highlightRequestId={personalBereichHighlightId}
        />
      )}

      {/* Print modal */}
      {printMenu&&(
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={()=>setPrintMenu(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Printer className="w-4 h-4"/>Drucken</h3>
              <button onClick={()=>setPrintMenu(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-gray-500"/></button>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {view==='month'?(
                <>
                  <button onClick={()=>{setPrintMenu(false);printMonthly(year,month,data,feiertage)}}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-left transition-colors w-full">
                    <span className="text-2xl">📄</span>
                    <div><div className="font-medium text-gray-800 text-sm">Monat drucken</div><div className="text-xs text-gray-400">{MONTHS[month]} {year}</div></div>
                  </button>
                  <button onClick={()=>{setPrintMenu(false);printAnnual(year,data,feiertage)}}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-left transition-colors w-full">
                    <span className="text-2xl">📅</span>
                    <div><div className="font-medium text-gray-800 text-sm">Jahresplanung</div><div className="text-xs text-gray-400">Alle 12 Monate {year}</div></div>
                  </button>
                </>
              ):(
                <>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 mb-1">Jahresübersicht</div>
                  {data.sections.map(s=>(
                    <button key={s.label} onClick={()=>{setPrintMenu(false);printYearSection(year,s,data,feiertage)}}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-left transition-colors w-full">
                      <span className="text-2xl">📅</span>
                      <div><div className="font-medium text-gray-800 text-sm">{s.label}</div><div className="text-xs text-gray-400">Jahresübersicht {year}</div></div>
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="h-safe-bottom sm:hidden"/>
          </div>
        </div>
      )}

    </div>
  )
}
