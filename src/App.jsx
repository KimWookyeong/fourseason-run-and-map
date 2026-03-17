import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut, 
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot
} from 'firebase/firestore';
import { 
  MapPin, 
  BarChart3, 
  PlusCircle, 
  List, 
  Navigation, 
  X, 
  User, 
  AlertTriangle, 
  Camera, 
  ChevronRight, 
  Trash2, 
  LogOut, 
  Sparkles, 
  Zap, 
  Award, 
  Lightbulb,
  Loader2
} from 'lucide-react';

/**
 * [사계절 런앤맵 프로젝트 - 최종 무결성 버전]
 * 1. UI: 모바일 뷰포트 높이(dvh) 및 절대 위치(fixed)를 통한 겹침 완전 방지
 * 2. AI: Gemini 2.5 Flash 최신 API 규격 및 오류 처리 적용
 * 3. DB: Firestore 규칙(Rule 1, 2, 3)을 준수한 데이터 송수신
 */

// --- Firebase 설정 (환경 변수 우선) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
      authDomain: "fourseason-run-and-map.firebaseapp.com",
      projectId: "fourseason-run-and-map",
      storageBucket: "fourseason-run-and-map.firebasestorage.app",
      messagingSenderId: "671510183044",
      appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
      databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
    };

const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-run-and-map';
const apiKey = ""; // Gemini API Key (Runtime에서 제공됨)

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_CENTER = [35.243, 129.092];

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiMessage, setAiMessage] = useState("활동가님의 기록을 기다리고 있어요! ✨");
  const [isGeneratingMsg, setIsGeneratingMsg] = useState(false);

  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup',
    area: '부산대/장전동',
    description: '',
    status: 'pending',
    customLocation: null,
    image: null
  });

  // --- Gemini API 호출 (Exponential Backoff) ---
  const callGemini = async (payload) => {
    let retries = 0;
    const maxRetries = 5;
    const model = "gemini-2.5-flash-preview-09-2025";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    while (retries < maxRetries) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (response.ok) return await response.json();
        const delay = Math.pow(2, retries) * 1000;
        await new Promise(res => setTimeout(res, delay));
        retries++;
      } catch (e) {
        retries++;
        if (retries === maxRetries) throw e;
      }
    }
  };

  // --- AI 이미지 분석 기능 ---
  const analyzeImage = async () => {
    if (!formData.image) return;
    setIsAnalyzing(true);
    try {
      const base64Data = formData.image.split(',')[1];
      const payload = {
        contents: [{
          parts: [
            { text: "Analyze this image and return valid JSON format ONLY. Schema: {\"category\": \"string\", \"description\": \"string\"}. Category must be one of (cup, smoke, plastic, bulky, etc). Description should be one kind sentence in Korean about its environmental impact." },
            { inlineData: { mimeType: "image/png", data: base64Data } }
          ]
        }],
        generationConfig: { responseMimeType: "application/json" }
      };
      const result = await callGemini(payload);
      const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
      const data = JSON.parse(textResponse || "{}");
      if (data.category) {
        setFormData(prev => ({ 
          ...prev, 
          category: data.category, 
          description: data.description || prev.description 
        }));
      }
    } catch (e) {
      console.error("AI Analysis failed", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Firebase 인증 (RULE 3) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try { await signInWithCustomToken(auth, __initial_auth_token); } 
          catch (e) { await signInAnonymously(auth); }
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Auth failed:", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Firestore 데이터 동기화 (RULE 1, 2) ---
  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime)); // JS 메모리 정렬 (Rule 2)
      setReports(formatted);
      updateMarkers(formatted);
    }, (err) => console.error("Firestore Error:", err));
    return () => unsubscribe();
  }, [user]);

  // --- Leaflet 지도 초기화 ---
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; 
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        if (reports.length > 0) updateMarkers(reports);
      }, 500);
    }
  }, [isScriptLoaded, activeTab]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const isMine = report.userName === nickname;
      const iconHtml = `<div style="background-color:${cat.color}; width:32px; height:32px; border-radius:10px; border:2px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 10px rgba(0,0,0,0.2); transform:rotate(45deg);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
    const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
    try {
      const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(reportsCollection, { 
        ...formData, 
        location: loc, 
        userName: nickname, 
        discoveredTime: new Date().toISOString() 
      });
      setFormData({ category: 'cup', area: '부산대/장전동', description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
    } catch (err) { alert("업로드 실패: " + err.message); }
  };

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData(prev => ({ ...prev, customLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      (err) => { setIsLocating(false); alert("GPS 권한을 허용해주세요."); },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  if (isSettingNickname) {
    return (
      <div className="full-screen bg-[#f0fdf4] flex flex-col items-center justify-center p-8 z-[9999]">
        <div className="bg-emerald-600 w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-xl"><Navigation size={40} className="text-white" fill="currentColor" /></div>
        <h1 className="text-3xl font-black text-slate-800 tracking-tighter mb-8 italic uppercase">Four Seasons</h1>
        <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-xs text-center border border-white">
          <h2 className="text-xl font-black text-slate-800 mb-6">반가워요 활동가님!</h2>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="닉네임" className="w-full p-4 rounded-2xl bg-emerald-50 border-none outline-none font-bold text-center text-emerald-800 mb-6" autoFocus />
            <button className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">참여하기 <ChevronRight size={18}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedRate = reports.length > 0 ? Math.round((reports.filter(r => r.status === 'solved').length / reports.length) * 100) : 0;

  return (
    <div className="app-root bg-[#f0fdf4]">
      {/* 고정 헤더 */}
      <header className="app-header bg-white/90 backdrop-blur-md px-6 flex justify-between items-center border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 rounded-lg text-white"><Navigation size={14} fill="currentColor"/></div>
          <span className="text-xs font-black text-slate-800 tracking-tighter uppercase">Four Seasons</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-emerald-100 px-3 py-1 rounded-full font-bold text-[10px] text-emerald-700">{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃하시겠습니까?")) { localStorage.removeItem('team_nickname'); setNickname(''); setIsSettingNickname(true); signOut(auth); }}} className="p-2 bg-slate-100 rounded-xl text-slate-400"><LogOut size={14}/></button>
        </div>
      </header>

      {/* 메인 탭 영역 */}
      <main className="app-main">
        {/* Tab 1: Map */}
        <div className={`tab-layer ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute bottom-6 left-4 right-4 z-[1001]">
            <div className="bg-white p-4 rounded-[30px] shadow-2xl flex justify-between items-center border border-emerald-50">
               <div className="flex gap-4 pl-2">
                 <div className="text-center"><p className="text-[8px] font-black text-slate-300 uppercase tracking-widest italic">Found</p><p className="text-lg font-black text-slate-800">{reports.length}</p></div>
                 <div className="text-center border-l border-slate-100 pl-4"><p className="text-[8px] font-black text-slate-300 uppercase tracking-widest italic">Solved</p><p className="text-lg font-black text-emerald-600">{reports.filter(r => r.status === 'solved').length}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-xs font-black flex items-center gap-2 active:scale-90 transition-all"><PlusCircle size={16}/> 기록하기</button>
            </div>
          </div>
        </div>

        {/* Tab 2: New Record (Overlay) */}
        <div className={`tab-layer overlay ${activeTab === 'add' ? 'open' : ''}`}>
          <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex justify-between items-center mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">New Record</h2><button onClick={() => setActiveTab('map')} className="p-2 bg-white rounded-xl text-slate-300"><X/></button></div>
            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 p-5 rounded-3xl text-white flex flex-col justify-between shadow-xl min-h-[120px]">
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1"><MapPin size={12}/> Location</span>
                  <button type="button" onClick={getGPS} className={`w-full py-2.5 rounded-xl text-[10px] font-black transition-all ${formData.customLocation ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'}`}>{isLocating ? "수신중..." : "위치 잡기"}</button>
                </div>
                <div className="relative">
                  <input type="file" accept="image/*" onChange={(e) => { const r = new FileReader(); r.onload = () => setFormData({...formData, image: r.result}); r.readAsDataURL(e.target.files[0]); }} className="hidden" id="photo" />
                  <label htmlFor="photo" className="cursor-pointer w-full h-[120px] rounded-3xl border-2 border-dashed border-emerald-100 flex flex-col items-center justify-center gap-2 bg-white">
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover rounded-[22px]" /> : <><Camera size={20} className="text-emerald-500"/><span className="text-[10px] font-black text-emerald-600">사진 추가</span></>}
                  </label>
                </div>
              </div>
              {formData.image && <button type="button" onClick={analyzeImage} disabled={isAnalyzing} className="w-full bg-emerald-100 text-emerald-700 font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all">{isAnalyzing ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} {isAnalyzing ? "AI 분석 중..." : "AI 쓰레기 자동 인식"}</button>}
              <div className="grid grid-cols-2 gap-2">
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-3 rounded-2xl border-2 flex items-center gap-3 transition-all ${formData.category === c.id ? 'border-emerald-500 bg-white shadow-md' : 'border-transparent bg-white/50 text-slate-400'}`}><span className="text-xl">{c.icon}</span><span className="text-[10px] font-black">{c.label}</span></button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요?" className="w-full p-5 bg-white rounded-3xl h-24 text-sm font-medium outline-none border border-emerald-50 shadow-inner resize-none" />
              <button className="w-full bg-emerald-600 text-white font-black py-5 rounded-3xl shadow-xl text-md active:scale-95 transition-all">지도에 업로드</button>
            </form>
          </div>
        </div>

        {/* Tab 3: Feed */}
        <div className={`tab-layer overlay ${activeTab === 'list' ? 'open' : ''}`}>
          <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex justify-between items-center mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">Team Feed</h2><button onClick={() => setActiveTab('map')} className="p-2 bg-white rounded-xl text-slate-300"><X/></button></div>
            {reports.length === 0 ? <div className="text-center py-20 font-bold text-slate-300 italic">기록이 없습니다.</div> : reports.map(r => (
              <div key={r.id} className="bg-white p-5 rounded-[35px] mb-5 shadow-sm border border-emerald-50">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3"><span className="text-2xl p-2 bg-emerald-50 rounded-xl">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div><h4 className="font-black text-slate-800 text-[13px]">{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4><p className="text-[9px] font-bold text-slate-400">{new Date(r.discoveredTime).toLocaleString()}</p></div>
                  </div>
                  <button onClick={() => { updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' }); }} className={`px-4 py-1.5 rounded-xl text-[9px] font-black ${r.status === 'solved' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="w-full h-48 object-cover rounded-[25px] mb-3 shadow-inner" />}
                <p className="text-[13px] font-medium text-slate-600 bg-emerald-50/50 p-4 rounded-2xl italic leading-relaxed border-l-4 border-emerald-400 mb-3">{r.description || "설명 없음"}</p>
                <div className="flex items-center justify-between pt-3 border-t border-emerald-50">
                  <span className="text-[10px] font-black text-slate-600 flex items-center gap-1"><User size={10}/> {r.userName}</span>
                  <div className="flex gap-2">
                    <span className="text-[8px] bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full font-black border border-emerald-100">{r.area}</span>
                    {r.userName === nickname && <button onClick={() => { if(window.confirm("기록을 삭제할까요?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id)); }} className="text-red-300 p-1"><Trash2 size={14}/></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab 4: Stats */}
        <div className={`tab-layer overlay ${activeTab === 'stats' ? 'open' : ''}`}>
           <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex justify-between items-center mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">Team Stats</h2><button onClick={() => setActiveTab('map')} className="p-2 bg-white rounded-xl text-slate-300"><X/></button></div>
            <div className="bg-slate-900 rounded-[35px] p-7 text-white mb-6 shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={100} fill="white"/></div>
               <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-widest mb-3 relative z-10"><Sparkles size={12}/> AI Counselor</div>
               <p className="text-lg font-bold leading-relaxed italic relative z-10">"{aiMessage}"</p>
               <div className="mt-6 relative z-10">
                  <div className="flex justify-between mb-2 text-[9px] font-black text-emerald-400 uppercase tracking-widest"><span>Team Success</span><span>{solvedRate}%</span></div>
                  <div className="h-1.5 w-full bg-emerald-900/50 rounded-full overflow-hidden"><div className="h-full bg-emerald-400 transition-all duration-1000" style={{width: `${solvedRate}%`}}></div></div>
               </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-8">
               <div className="bg-white p-6 rounded-[30px] border border-emerald-50 text-center"><p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest">Total</p><p className="text-3xl font-black text-slate-800">{reports.length}</p></div>
               <div className="bg-white p-6 rounded-[30px] border border-emerald-50 text-center"><p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest">Solved</p><p className="text-3xl font-black text-emerald-600">{reports.filter(r => r.status === 'solved').length}</p></div>
            </div>
           </div>
        </div>
      </main>

      {/* 고정 내비바 */}
      <nav className="app-nav bg-white/95 backdrop-blur-xl border-t border-emerald-100 flex justify-around items-center shadow-[0_-5px_20px_rgba(0,0,0,0.02)]">
        <button onClick={() => setActiveTab('map')} className={`nav-btn ${activeTab === 'map' ? 'active' : ''}`}><MapPin size={24} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3} /><span className="text-[9px] font-black uppercase">Map</span></button>
        <button onClick={() => setActiveTab('list')} className={`nav-btn ${activeTab === 'list' ? 'active' : ''}`}><List size={24} strokeWidth={3} /><span className="text-[9px] font-black uppercase">Feed</span></button>
        <button onClick={() => setActiveTab('stats')} className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}><BarChart3 size={24} strokeWidth={3} /><span className="text-[9px] font-black uppercase">Stats</span></button>
      </nav>

      {/* 전역 스타일 시트 (구조 고정용) */}
      <style>{`
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        .full-screen { position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; }
        .app-root { position: fixed; inset: 0; width: 100%; height: 100dvh; display: flex; flex-direction: column; }
        .app-header { height: 60px; flex-shrink: 0; z-index: 2000; }
        .app-main { flex: 1; position: relative; width: 100%; overflow: hidden; }
        .app-nav { height: 75px; flex-shrink: 0; z-index: 2000; padding-bottom: env(safe-area-inset-bottom, 15px); }
        .tab-layer { position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden; opacity: 0; transition: opacity 0.3s; background: #f0fdf4; }
        .tab-layer.visible { visibility: visible; opacity: 1; z-index: 10; }
        .tab-layer.overlay { transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s; visibility: visible; opacity: 1; z-index: 50; overflow-y: auto; }
        .tab-layer.overlay.open { transform: translateY(0); }
        .nav-btn { display: flex; flex-direction: column; items-center; gap: 4px; color: #cbd5e1; border: none; background: none; cursor: pointer; transition: all 0.2s; }
        .nav-btn.active { color: #10b981; transform: scale(1.1); }
        .leaflet-container { width: 100% !important; height: 100% !important; z-index: 1 !important; }
        .leaflet-popup-content-wrapper { border-radius: 20px; box-shadow: 0 10px 20px rgba(16,185,129,0.1); border: 1px solid #f0fdf4; }
        .custom-pin { background: none; border: none; }
        ::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
      <script src="https://cdn.tailwindcss.com"></script>
    </div>
  );
}