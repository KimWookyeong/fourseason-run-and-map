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
 * [사계절 런앤맵 프로젝트 - 디자인 복구 및 기능 완전 해결 버전]
 * 1. UI: '원래 화면' 디자인 복구 및 레이아웃 겹침 완전 방지 (Absolute Positioning)
 * 2. GPS: 고정밀 수신 옵션 및 권한 에러 핸들링 보강
 * 3. AI: Gemini 2.5 Flash API 최신 규격 적용 및 결과 자동 입력
 * 4. Upload: Firestore Rule 1, 3 준수 및 저장 확인 알림 추가
 */

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
const apiKey = ""; // Gemini API Key

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

  // --- Gemini API: AI 분석 및 응원 메시지 ---
  const callGemini = async (payload) => {
    let retries = 0;
    const model = "gemini-2.5-flash-preview-09-2025";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    while (retries < 5) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (response.ok) return await response.json();
        await new Promise(res => setTimeout(res, Math.pow(2, retries) * 1000));
        retries++;
      } catch (e) { retries++; if (retries === 5) throw e; }
    }
  };

  const analyzeImage = async () => {
    if (!formData.image) return;
    setIsAnalyzing(true);
    try {
      const base64Data = formData.image.split(',')[1];
      const payload = {
        contents: [{
          role: "user",
          parts: [
            { text: "이 쓰레기 사진을 분석해줘. JSON 형식으로만 답해줘. 형식: {\"category\": \"cup|smoke|plastic|bulky|etc\", \"description\": \"내용\"}. category는 제공한 5개 중 하나로 선택하고, description은 환경에 미치는 영향과 함께 한국어 한 문장으로 써줘." },
            { inlineData: { mimeType: "image/png", data: base64Data } }
          ]
        }],
        generationConfig: { responseMimeType: "application/json" }
      };
      const result = await callGemini(payload);
      const data = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      if (data.category) {
        setFormData(prev => ({ ...prev, category: data.category, description: data.description || prev.description }));
      }
    } catch (e) { console.error("AI 분석 에러:", e); } 
    finally { setIsAnalyzing(false); }
  };

  const updateAiMessage = async () => {
    if (reports.length === 0) return;
    setIsGeneratingMsg(true);
    try {
      const solved = reports.filter(r => r.status === 'solved').length;
      const payload = {
        contents: [{
          role: "user",
          parts: [{ text: `현재 활동가들이 ${reports.length}개를 찾고 ${solved}개를 해결했어. 활동가들에게 동기부여를 주는 짧고 따뜻한 한마디를 한국어로 1문장 생성해줘.` }]
        }]
      };
      const result = await callGemini(payload);
      setAiMessage(result.candidates?.[0]?.content?.parts?.[0]?.text || aiMessage);
    } catch (e) { console.error(e); } finally { setIsGeneratingMsg(false); }
  };

  // --- Firebase: 인증 및 데이터 (Rule 준수) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else { await signInAnonymously(auth); }
      } catch (e) { await signInAnonymously(auth); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(formatted);
      updateMarkers(formatted);
    });
    return () => unsubscribe();
  }, [user]);

  // --- 지도 라이브러리 및 디자인 로드 ---
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        if (reports.length > 0) updateMarkers(reports);
      }, 300);
    }
    if (activeTab === 'stats') updateAiMessage();
  }, [isScriptLoaded, activeTab]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const isMine = report.userName === nickname;
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:8px; border:2px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>기록: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return alert("인증 대기 중입니다...");
    const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
    const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
    try {
      const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(reportsCollection, { ...formData, location: loc, userName: nickname, discoveredTime: new Date().toISOString() });
      setFormData({ category: 'cup', area: '부산대/장전동', description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("지도로 공유되었습니다! 🏁");
    } catch (err) { alert("업로드 중 오류가 발생했습니다."); }
  };

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData(prev => ({ ...prev, customLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      () => { setIsLocating(false); alert("GPS 권한을 허용해 주세요."); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // --- 닉네임 입력 화면 (원래 화면 디자인 완벽 복구) ---
  if (isSettingNickname) {
    return (
      <div className="fixed-layout bg-emerald-50 flex-center flex-col z-top">
        <div className="logo-icon mb-6 shadow-xl"><Navigation size={40} className="text-white" fill="currentColor" /></div>
        <h1 className="title-main mb-1 italic uppercase">Four Seasons</h1>
        <p className="subtitle-sub mb-8">RUN & MAP GEUMJEONG</p>
        <div className="card-box p-8 shadow-2xl w-full max-w-xs text-center border-white">
          <h2 className="welcome-text mb-6">반가워요 활동가님!</h2>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="닉네임 입력" className="input-field mb-6" autoFocus />
            <button className="btn-join w-full py-4 text-lg">지도 합류하기 <ChevronRight size={18}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedRate = reports.length > 0 ? Math.round((reports.filter(r => r.status === 'solved').length / reports.length) * 100) : 0;

  return (
    <div className="fixed-layout flex-col bg-emerald-50 font-sans">
      {/* 고정 헤더 */}
      <header className="header-bar bg-white flex items-center justify-between px-6 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 rounded-lg text-white"><Navigation size={14} fill="currentColor"/></div>
          <span className="text-xs font-black text-slate-800 uppercase tracking-tighter">Four Seasons</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-user">{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃할까요?")) { localStorage.removeItem('team_nickname'); setNickname(''); setIsSettingNickname(true); signOut(auth); }}} className="btn-sub"><LogOut size={14}/></button>
        </div>
      </header>

      {/* 메인 콘텐츠 (탭 레이어) */}
      <main className="main-content">
        {/* Tab 1: 지도 */}
        <div className={`tab-layer ${activeTab === 'map' ? 'active' : ''}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="map-stats-overlay">
             <div className="flex gap-4">
               <div className="text-center"><p className="label-sm">Found</p><p className="val-md">{reports.length}</p></div>
               <div className="text-center border-l pl-4"><p className="label-sm">Solved</p><p className="val-md text-emerald-600">{reports.filter(r => r.status === 'solved').length}</p></div>
             </div>
             <button onClick={() => setActiveTab('add')} className="btn-record"><PlusCircle size={16}/> 기록하기</button>
          </div>
        </div>

        {/* Tab 2: 기록 추가 (오버레이) */}
        <div className={`tab-layer overlay ${activeTab === 'add' ? 'open' : ''}`}>
          <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex items-center justify-between mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">New Record</h2><button onClick={() => setActiveTab('map')} className="btn-close"><X/></button></div>
            <form onSubmit={handleSave} className="flex flex-col gap-5">
              <div className="grid-2 gap-4">
                <div className="gps-card p-5 flex-col justify-between">
                  <span className="label-gps uppercase flex items-center gap-1"><MapPin size={12}/> GPS</span>
                  <button type="button" onClick={getGPS} className={`btn-gps ${formData.customLocation ? 'success' : ''}`}>{isLocating ? "수신중..." : "위치 잡기"}</button>
                </div>
                <div className="relative">
                  <input type="file" accept="image/*" onChange={(e) => { const r = new FileReader(); r.onload = () => setFormData({...formData, image: r.result}); r.readAsDataURL(e.target.files[0]); }} className="hidden" id="photo" />
                  <label htmlFor="photo" className="photo-box flex-center flex-col gap-2">
                    {formData.image ? <img src={formData.image} className="img-full" /> : <><Camera size={20} className="text-emerald-500"/><span className="label-gps text-emerald-600">사진 추가</span></>}
                  </label>
                </div>
              </div>
              {formData.image && <button type="button" onClick={analyzeImage} disabled={isAnalyzing} className="btn-ai">{isAnalyzing ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} {isAnalyzing ? "AI 분석 중..." : "AI 쓰레기 자동 인식"}</button>}
              <div className="grid-2 gap-2">
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`btn-cat ${formData.category === c.id ? 'active' : ''}`}><span className="text-xl">{c.icon}</span><span className="label-gps">{c.label}</span></button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요?" className="input-area" />
              <button className="btn-upload">지도에 업로드</button>
            </form>
          </div>
        </div>

        {/* Tab 3: 피드 */}
        <div className={`tab-layer overlay ${activeTab === 'list' ? 'open' : ''}`}>
          <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex items-center justify-between mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">Team Feed</h2><button onClick={() => setActiveTab('map')} className="btn-close"><X/></button></div>
            {reports.length === 0 ? <div className="text-center py-20 font-bold text-slate-300 italic">기록이 없습니다.</div> : reports.map(r => (
              <div key={r.id} className="feed-card shadow-sm mb-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3"><span className="feed-icon">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div><h4 className="feed-title">{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4><p className="feed-date">{new Date(r.discoveredTime).toLocaleString()}</p></div>
                  </div>
                  <button onClick={() => { updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' }); }} className={`btn-status ${r.status === 'solved' ? 'solved' : 'pending'}`}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="feed-img mb-3 shadow-inner" />}
                <p className="feed-desc">{r.description || "설명 없음"}</p>
                <div className="feed-footer">
                  <span className="feed-user"><User size={10}/> {r.userName}</span>
                  <div className="flex gap-2 items-center">
                    <span className="area-label">{r.area}</span>
                    {r.userName === nickname && <button onClick={() => { if(window.confirm("삭제할까요?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id)); }} className="text-red-300"><Trash2 size={14}/></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab 4: 통계 */}
        <div className={`tab-layer overlay ${activeTab === 'stats' ? 'open' : ''}`}>
           <div className="max-w-md mx-auto p-6 pb-32">
            <div className="flex justify-between items-center mb-8"><h2 className="text-xl font-black text-slate-800 uppercase italic">Team Stats</h2><button onClick={() => setActiveTab('map')} className="btn-close"><X/></button></div>
            <div className="ai-card shadow-2xl relative overflow-hidden">
               <div className="ai-bg-icon"><Zap size={100} fill="white"/></div>
               <div className="ai-header"><Sparkles size={12}/> AI Counselor</div>
               <p className="ai-msg">"{aiMessage}"</p>
               <div className="mt-6 relative z-10">
                  <div className="flex justify-between mb-2 text-xs font-black text-emerald-400 uppercase tracking-widest"><span>Team Success</span><span>{solvedRate}%</span></div>
                  <div className="prog-bg"><div className="prog-fill" style={{width: `${solvedRate}%`}}></div></div>
               </div>
            </div>
            <div className="grid-2 gap-3 mb-8">
               <div className="stat-box-inner"><p className="label-sm text-slate-300">Total</p><p className="text-3xl font-black text-slate-800">{reports.length}</p></div>
               <div className="stat-box-inner"><p className="label-sm text-slate-300">Solved</p><p className="text-3xl font-black text-emerald-600">{reports.filter(r => r.status === 'solved').length}</p></div>
            </div>
           </div>
        </div>
      </main>

      {/* 하단 내비바 */}
      <nav className="bottom-nav border-t border-emerald-100">
        <button onClick={() => setActiveTab('map')} className={`nav-item ${activeTab === 'map' ? 'active' : ''}`}><MapPin size={24} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3} /><span className="nav-text">Map</span></button>
        <button onClick={() => setActiveTab('list')} className={`nav-item ${activeTab === 'list' ? 'active' : ''}`}><List size={24} strokeWidth={3} /><span className="nav-text">Feed</span></button>
        <button onClick={() => setActiveTab('stats')} className={`nav-item ${activeTab === 'stats' ? 'active' : ''}`}><BarChart3 size={24} strokeWidth={3} /><span className="nav-text">Stats</span></button>
      </nav>

      <style>{`
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f0fdf4; font-family: -apple-system, sans-serif; }
        .fixed-layout { position: fixed; inset: 0; display: flex; flex-direction: column; width: 100%; height: 100dvh; overflow: hidden; }
        .flex-center { display: flex; align-items: center; justify-content: center; }
        .flex-col { flex-direction: column; }
        .z-top { z-index: 10000; }
        
        /* 닉네임 입력 (원래 디자인) */
        .logo-icon { background: #10b981; width: 80px; height: 80px; border-radius: 20px; display: flex; align-items: center; justify-content: center; transform: rotate(12deg); }
        .title-main { font-size: 2.5rem; font-weight: 900; color: #1e293b; letter-spacing: -0.05em; }
        .subtitle-sub { font-size: 0.75rem; font-weight: 900; color: #10b981; letter-spacing: 0.3em; }
        .card-box { background: white; border-radius: 40px; border: 1px solid white; }
        .welcome-text { font-size: 1.25rem; font-weight: 900; color: #1e293b; }
        .input-field { width: 100%; padding: 16px; border-radius: 20px; background: #ecfdf5; border: none; outline: none; font-weight: bold; text-align: center; color: #065f46; font-size: 1.1rem; }
        .btn-join { background: #10b981; color: white; border: none; font-weight: 900; border-radius: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
        
        /* 메인 구조 */
        .header-bar { height: 60px; z-index: 2000; }
        .main-content { flex: 1; position: relative; overflow: hidden; }
        .bottom-nav { height: 75px; z-index: 2000; display: flex; align-items: center; justify-content: space-around; background: white; padding-bottom: 15px; }
        
        .tab-layer { position: absolute; inset: 0; visibility: hidden; opacity: 0; transition: opacity 0.3s; background: #f0fdf4; }
        .tab-layer.active { visibility: visible; opacity: 1; z-index: 10; }
        .tab-layer.overlay { transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); visibility: visible; opacity: 1; z-index: 50; overflow-y: auto; }
        .tab-layer.overlay.open { transform: translateY(0); }
        
        .map-stats-overlay { position: absolute; bottom: 20px; left: 16px; right: 16px; background: white; padding: 16px; border-radius: 30px; display: flex; justify-content: space-between; align-items: center; z-index: 1001; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .label-sm { font-size: 8px; font-weight: 900; color: #cbd5e1; text-transform: uppercase; }
        .val-md { font-size: 1.25rem; font-weight: 900; margin: 0; }
        .btn-record { background: #1e293b; color: white; border: none; font-weight: 900; padding: 12px 24px; border-radius: 16px; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        
        /* 폼 & 피드 */
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; }
        .gps-card { background: #1e293b; border-radius: 24px; display: flex; color: white; }
        .label-gps { font-size: 10px; font-weight: 900; }
        .btn-gps { border: none; padding: 10px; border-radius: 12px; font-weight: 900; font-size: 10px; background: white; color: #1e293b; }
        .btn-gps.success { background: #10b981; color: white; }
        .photo-box { width: 100%; height: 120px; border-radius: 24px; border: 2px dashed #d1fae5; background: white; overflow: hidden; cursor: pointer; }
        .img-full { width: 100%; height: 100%; object-fit: cover; }
        .btn-ai { width: 100%; background: #ecfdf5; color: #059669; border: 1px solid #d1fae5; padding: 16px; border-radius: 16px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-cat { background: white; border: 2px solid transparent; border-radius: 20px; padding: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .btn-cat.active { border-color: #10b981; box-shadow: 0 4px 12px rgba(16,185,129,0.1); }
        .input-area { width: 100%; padding: 20px; border-radius: 24px; border: none; background: white; resize: none; min-height: 100px; font-family: inherit; }
        .btn-upload { background: #10b981; color: white; border: none; padding: 20px; border-radius: 24px; font-weight: 900; font-size: 1.1rem; cursor: pointer; }
        
        .feed-card { background: white; border-radius: 35px; padding: 20px; border: 1px solid #f0fdf4; }
        .feed-icon { font-size: 1.5rem; background: #f0fdf4; padding: 8px; border-radius: 12px; }
        .feed-title { font-weight: 900; color: #1e293b; font-size: 14px; margin: 0; }
        .feed-date { font-size: 9px; color: #94a3b8; margin: 0; }
        .btn-status { border: none; padding: 6px 12px; border-radius: 10px; font-size: 9px; font-weight: 900; cursor: pointer; }
        .btn-status.solved { background: #10b981; color: white; }
        .btn-status.pending { background: #f1f5f9; color: #94a3b8; }
        .feed-img { width: 100%; border-radius: 25px; height: 180px; object-fit: cover; }
        .feed-desc { background: rgba(16,185,129,0.05); padding: 16px; border-radius: 20px; border-left: 4px solid #10b981; font-size: 13px; font-style: italic; color: #475569; }
        .feed-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f8fafc; padding-top: 12px; }
        .feed-user { font-size: 10px; font-weight: 900; color: #64748b; display: flex; align-items: center; gap: 4px; }
        .area-label { background: #ecfdf5; color: #10b981; padding: 4px 10px; border-radius: 12px; font-size: 9px; font-weight: 900; }
        
        /* 통계 */
        .ai-card { background: #1e293b; border-radius: 35px; padding: 28px; color: white; margin-bottom: 24px; }
        .ai-bg-icon { position: absolute; top: 0; right: 0; padding: 16px; opacity: 0.1; }
        .ai-header { display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 900; color: #10b981; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 12px; }
        .ai-msg { font-size: 1.1rem; font-weight: bold; line-height: 1.6; font-style: italic; position: relative; z-index: 10; margin: 0; }
        .prog-bg { height: 6px; background: rgba(16,185,129,0.2); border-radius: 3px; overflow: hidden; }
        .prog-fill { height: 100%; background: #10b981; transition: width 1s; }
        .stat-box-inner { background: white; padding: 24px; border-radius: 30px; text-align: center; }
        
        /* 내비바 */
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: #cbd5e1; background: none; border: none; cursor: pointer; transition: all 0.2s; }
        .nav-item.active { color: #10b981; transform: scale(1.1); }
        .nav-text { font-size: 9px; font-weight: 900; text-transform: uppercase; }
        .badge-user { background: #ecfdf5; color: #047857; font-weight: 900; font-size: 10px; padding: 4px 12px; border-radius: 20px; }
        .btn-sub { background: #f1f5f9; border: none; padding: 8px; border-radius: 10px; color: #94a3b8; cursor: pointer; }
        .btn-close { background: white; border: none; padding: 8px; border-radius: 12px; color: #cbd5e1; cursor: pointer; }

        .leaflet-container { width: 100% !important; height: 100% !important; z-index: 1 !important; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
    </div>
  );
}