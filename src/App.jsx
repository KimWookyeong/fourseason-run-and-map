import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, set } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  MapPin, 
  BarChart3, 
  PlusCircle, 
  List, 
  Navigation, 
  LocateFixed, 
  Loader2, 
  X, 
  User, 
  AlertTriangle, 
  RefreshCw,
  TrendingUp,
  Camera,
  Trash2,
  Heart,
  ChevronRight,
  Leaf
} from 'lucide-react';

/**
 * [사계절 런앤맵 프로젝트 최종 배포본]
 * 디자인 도구가 작동하지 않는 환경을 위해 CDN 로딩을 강화하고
 * 메인 화면을 연한 녹색 테마로 아주 예쁘게 리뉴얼했습니다.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
  authDomain: "fourseason-run-and-map.firebaseapp.com",
  projectId: "fourseason-run-and-map",
  storageBucket: "fourseason-run-and-map.firebasestorage.app",
  messagingSenderId: "671510183044",
  appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
  measurementId: "G-NNKBYB9Y5G",
  databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
};

// 1. Firebase 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = [35.243, 129.092];

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null); 
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [islocating, setIsLocating] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup',
    area: GEUMJEONG_AREAS[0],
    description: '',
    status: 'pending',
    customLocation: null,
    image: null
  });

  // 라이브러리 및 스타일 강제 로드 로직
  useEffect(() => {
    // Tailwind CSS 강제 주입 (디자인 깨짐 방지 핵심)
    if (!document.getElementById('tailwind-cdn')) {
      const twScript = document.createElement('script');
      twScript.id = 'tailwind-cdn';
      twScript.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(twScript);
    }

    // Leaflet 지도 스타일
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // Leaflet 지도 엔진
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      clearInterval(timer);
      if (leafletMap.current) leafletMap.current.remove();
    };
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        if (reports.length > 0) updateMarkers(reports);
      }, 200);
    }
  }, [isScriptLoaded, activeTab]);

  // 인증
  useEffect(() => {
    const tryLogin = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        setAuthError(err.code === 'auth/configuration-not-found' ? "익명 로그인을 켜주세요." : err.message);
      }
    };
    tryLogin();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 데이터 실시간 수신
  useEffect(() => {
    if (!user) return;
    const reportsRef = ref(db, 'reports');
    const unsubscribe = onValue(reportsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] })).reverse();
        setReports(formatted);
        updateMarkers(formatted);
      } else {
        setReports([]);
        if (leafletMap.current) {
          Object.values(markersRef.current).forEach(m => m.remove());
          markersRef.current = {};
        }
      }
    });
    return () => unsubscribe();
  }, [user, isScriptLoaded, activeTab]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    data.forEach(report => {
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const iconHtml = `
        <div style="background-color:${cat.color}; width:34px; height:34px; border-radius:12px; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 12px rgba(0,0,0,0.15); transform:rotate(45deg);">
          <div style="transform:rotate(-45deg)">${cat.icon}</div>
        </div>
      `;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      
      marker.bindPopup(`
        <div style="font-family:sans-serif; min-width:140px;">
          <b style="color:${cat.color}">${cat.icon} ${cat.label}</b><br/>
          <small>by ${report.userName}</small>
        </div>
      `);
      markersRef.current[report.id] = marker;
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, image: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFormData(prev => ({ ...prev, customLocation: loc }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([loc.lat, loc.lng], 16);
      },
      () => { setIsLocating(false); alert("GPS를 켜주세요."); }
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
    const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
    await push(ref(db, 'reports'), { 
      ...formData, location: loc, userName: nickname, discoveredTime: currentTime.toISOString() 
    });
    setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
    setActiveTab('map');
  };

  if (authError) return <div className="p-10 text-center font-bold text-red-500">{authError}</div>;

  /**
   * [메인 화면 - 연한 녹색 업그레이드 디자인]
   */
  if (isSettingNickname) {
    return (
      <div className="min-h-screen bg-[#f0fdf4] flex flex-col items-center justify-center p-8 font-sans relative overflow-hidden">
        {/* 장식용 배경 요소 */}
        <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-emerald-200/40 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-5%] right-[-5%] w-80 h-80 bg-green-200/30 rounded-full blur-3xl"></div>

        <div className="w-full max-w-sm z-10 text-center">
          {/* 상단 로고 영역 */}
          <div className="mb-12 animate-bounce-slow">
            <div className="bg-emerald-600 w-24 h-24 rounded-[32px] flex items-center justify-center mb-6 mx-auto shadow-2xl shadow-emerald-200/50 rotate-12">
              <Navigation size={48} className="text-white" fill="currentColor" />
            </div>
            <h1 className="text-4xl font-black text-slate-800 tracking-tighter italic mb-1 uppercase">Four Seasons</h1>
            <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold text-[10px] tracking-[0.4em] uppercase opacity-80">
              <Leaf size={12}/> Run & Map Geumjeong
            </div>
          </div>

          {/* 입력 카드 */}
          <div className="bg-white/80 backdrop-blur-2xl p-10 rounded-[48px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-white/50 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500"></div>
            
            <div className="mb-8">
              <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">반가워요 활동가님!</h2>
              <p className="text-slate-500 text-xs font-medium leading-relaxed">
                금정구의 깨끗한 내일을 위해<br/>오늘 사용할 닉네임을 적어주세요.
              </p>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }} className="space-y-4">
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-500 transition-transform group-focus-within:scale-110">
                  <User size={22}/>
                </div>
                <input 
                  type="text" 
                  value={nickname} 
                  onChange={e => setNickname(e.target.value)} 
                  placeholder="예: 금정_철수" 
                  className="w-full pl-14 pr-6 py-5 rounded-[24px] bg-emerald-50/50 border-2 border-transparent focus:border-emerald-500 focus:bg-white outline-none font-bold text-slate-700 transition-all text-lg shadow-inner"
                  autoFocus 
                />
              </div>
              
              <button className="w-full bg-emerald-600 text-white font-black py-5 rounded-[24px] shadow-xl shadow-emerald-200 active:scale-95 transition-all text-lg flex items-center justify-center gap-3 hover:bg-emerald-700 group">
                활동 시작하기 
                <div className="bg-white/20 p-1 rounded-full group-hover:translate-x-1 transition-transform">
                  <ChevronRight size={18}/>
                </div>
              </button>
            </form>
          </div>
          
          <div className="mt-12 flex flex-col items-center gap-4">
             <div className="flex items-center gap-4 text-slate-300">
                <Heart size={16} fill="currentColor"/>
                <div className="w-12 h-[1px] bg-slate-200"></div>
                <Heart size={16} fill="currentColor"/>
             </div>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
               © 2024 Four Seasons Team Project
             </p>
          </div>
        </div>

        <style>{`
          @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          .animate-bounce-slow { animation: bounce-slow 3s ease-in-out infinite; }
        `}</style>
      </div>
    );
  }

  // 본 화면 (메인 서비스)
  return (
    <div className="h-screen flex flex-col bg-[#f0fdf4] font-sans text-slate-900 overflow-hidden">
      <header className="bg-white/80 backdrop-blur-xl p-4 border-b border-emerald-100 flex justify-between items-center z-[1000] sticky top-0 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg shadow-emerald-200"><Navigation size={18} fill="currentColor"/></div>
          <h1 className="text-sm font-black text-slate-800 tracking-tighter uppercase">Four Seasons</h1>
        </div>
        <div className="bg-emerald-100/50 px-3 py-1.5 rounded-full border border-emerald-100 font-bold text-[11px] text-emerald-700 flex items-center gap-2">
           <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> {nickname}
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* 탭 1: 지도 */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'map' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute bottom-28 left-4 right-4 z-[1001]">
            <div className="bg-white/95 backdrop-blur-md p-5 rounded-[36px] shadow-2xl flex justify-between items-center border border-emerald-50">
               <div className="flex gap-6 pl-4">
                 <div className="text-center">
                   <p className="text-[9px] font-black text-slate-400 mb-1 tracking-widest uppercase italic">Trash</p>
                   <p className="text-2xl font-black text-slate-800 leading-none">{reports.length}</p>
                 </div>
                 <div className="text-center border-l border-slate-100 pl-6">
                   <p className="text-[9px] font-black text-slate-400 mb-1 tracking-widest uppercase italic">Solved</p>
                   <p className="text-2xl font-black text-emerald-600 leading-none">{reports.filter(r => r.status === 'solved').length}</p>
                 </div>
               </div>
               <button onClick={() => setActiveTab('add')} className="bg-slate-900 text-white px-6 py-4 rounded-[24px] text-sm font-black flex items-center gap-2 active:scale-90 transition-all shadow-xl shadow-slate-200">
                 <PlusCircle size={20}/> 기록하기
               </button>
            </div>
          </div>
        </div>

        {/* 탭 2: 기록 추가 */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-50 transition-transform duration-500 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="max-w-md mx-auto">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black tracking-tighter text-slate-800 italic uppercase">New Report</h2>
              <button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-400 shadow-sm active:scale-90"><X/></button>
            </div>
            <form onSubmit={handleSave} className="space-y-5 pb-20">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 p-6 rounded-[32px] text-white flex flex-col justify-between shadow-xl min-h-[140px]">
                  <span className="text-[10px] font-black flex items-center gap-2 uppercase tracking-widest text-emerald-400 mb-2"><MapPin size={14}/> Location</span>
                  <button type="button" onClick={getGPS} className={`px-4 py-3 rounded-2xl text-[10px] font-black transition-all ${formData.customLocation ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'}`}>
                    {islocating ? <Loader2 className="animate-spin" size={14}/> : <LocateFixed size={14}/>} {formData.customLocation ? "획득 성공" : "위치 잡기"}
                  </button>
                </div>
                
                <div className="relative">
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} className="hidden" id="camera-input-sub" />
                  <label htmlFor="camera-input-sub" className={`cursor-pointer w-full h-[140px] rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all ${formData.image ? 'border-emerald-500 bg-white' : 'border-emerald-200 bg-white/40'}`}>
                    {formData.image ? (
                      <img src={formData.image} className="w-full h-full object-cover rounded-[30px]" alt="preview" />
                    ) : (
                      <>
                        <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600 shadow-sm"><Camera size={24}/></div>
                        <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">현장 사진</span>
                      </>
                    )}
                  </label>
                  {formData.image && (
                    <button type="button" onClick={() => setFormData({...formData, image: null})} className="absolute -top-2 -right-2 p-2 bg-red-500 text-white rounded-full shadow-lg"><X size={12}/></button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-5 rounded-3xl border-2 flex items-center gap-4 transition-all shadow-sm ${formData.category === c.id ? 'border-emerald-500 bg-white text-emerald-700' : 'border-transparent bg-white/50 text-slate-400'}`}>
                    <span className="text-2xl">{c.icon}</span><span className="text-xs font-black">{c.label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="w-full p-5 rounded-3xl bg-white/70 backdrop-blur-sm border-none font-bold text-sm outline-none shadow-sm focus:ring-2 ring-emerald-400">
                  {GEUMJEONG_AREAS.map(a => <option key={a}>{a}</option>)}
                </select>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황 설명" className="w-full p-6 bg-white/70 backdrop-blur-sm rounded-[32px] h-32 text-sm font-medium outline-none shadow-sm resize-none focus:ring-2 ring-emerald-400" />
              </div>
              <button className="w-full bg-emerald-600 text-white font-black py-6 rounded-[32px] shadow-2xl text-lg active:scale-95 transition-all">기록 업로드</button>
            </form>
          </div>
        </div>

        {/* 탭 3: 피드 */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-20 transition-transform duration-500 ${activeTab === 'list' ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="max-w-md mx-auto">
            <h2 className="text-2xl font-black mb-8 flex items-center gap-3 text-slate-800 italic uppercase">Team Feed</h2>
            {reports.length === 0 ? (
              <div className="text-center py-24 text-emerald-300 font-bold italic">아직 기록이 없습니다.</div>
            ) : reports.map(r => (
              <div key={r.id} className="bg-white p-6 rounded-[36px] mb-6 shadow-md border border-emerald-100/50">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl p-2 bg-emerald-50 rounded-2xl">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div>
                      <h4 className="font-black text-slate-800 text-sm">{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(r.discoveredTime).toLocaleString('ko-KR')}</p>
                    </div>
                  </div>
                  <button onClick={() => set(ref(db, `reports/${r.id}/status`), r.status === 'pending' ? 'solved' : 'pending')} className={`px-4 py-2 rounded-2xl text-[10px] font-black transition-all ${r.status === 'solved' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>
                    {r.status === 'solved' ? '해결됨 ✓' : '해결하기'}
                  </button>
                </div>
                {r.image && <img src={r.image} className="w-full h-48 object-cover rounded-[28px] mb-4 shadow-inner" alt="쓰레기 현장" />}
                <p className="text-sm font-medium text-slate-600 mb-6 bg-emerald-50/50 p-5 rounded-[28px] italic leading-relaxed border-l-4 border-emerald-400">
                  {r.description || "상세 설명이 없습니다."}
                </p>
                <div className="flex items-center justify-between pt-4 border-t border-emerald-50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-100 rounded-2xl flex items-center justify-center text-[10px] font-black text-emerald-700">{r.userName ? r.userName[0] : '익'}</div>
                    <span className="text-[11px] font-black text-slate-600">{r.userName} 활동가</span>
                  </div>
                  <span className="text-[9px] bg-white text-emerald-600 px-3 py-1.5 rounded-full font-black border border-emerald-100 uppercase tracking-widest">{r.area}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <nav className="bg-white/80 backdrop-blur-2xl border-t border-emerald-100 p-5 pb-8 flex justify-around items-center z-[2000] sticky bottom-0 shadow-[0_-10px_30px_rgba(16,185,129,0.05)]">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-2 transition-all ${activeTab === 'map' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span className="text-[9px] font-black uppercase tracking-tighter">Map</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-2 transition-all ${activeTab === 'list' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <List size={26} strokeWidth={3}/>
          <span className="text-[9px] font-black uppercase tracking-tighter">Feed</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-2 transition-all ${activeTab === 'stats' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={26} strokeWidth={3}/>
          <span className="text-[9px] font-black uppercase tracking-tighter">Stats</span>
        </button>
      </nav>

      <style>{`.leaflet-container { font-family: inherit; z-index: 1 !important; background: #f0fdf4; }.leaflet-popup-content-wrapper { border-radius: 28px; padding: 6px; box-shadow: 0 15px 35px rgba(16,185,129,0.15); border: 1px solid #f0fdf4; }.custom-pin { background: none; border: none; }::-webkit-scrollbar { width: 0px; background: transparent; }`}</style>
    </div>
  );
}