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
  onSnapshot, 
  query, 
  timestamp 
} from 'firebase/firestore';
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
  Image as ImageIcon,
  ChevronRight,
  Heart,
  Trash2,
  LogOut,
  Sparkles,
  Zap,
  Award,
  Lightbulb
} from 'lucide-react';

/**
 * [사계절 런앤맵 프로젝트 - AI 통합 & 오류 수정 최종본]
 * - Firebase Auth Token Mismatch 해결 (Fallback 로직 추가)
 * - Firestore 기반 데이터 저장 (규칙 준수)
 * - AI 이미지 분석 및 자동 설명 생성
 */

// 전역 변수 설정 (시스템 제공 환경 변수 우선 사용)
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
const apiKey = ""; // Gemini API Key (제공된 환경에서 자동 처리)

// Firebase 서비스 초기화
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

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = [35.243, 129.092];

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  
  // AI States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiMessage, setAiMessage] = useState("활동가님의 기록을 기다리고 있어요! ✨");
  const [isGeneratingMsg, setIsGeneratingMsg] = useState(false);

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

  // --- Gemini API Helper (지수 백오프 적용) ---
  const callGemini = async (payload) => {
    let retries = 0;
    const maxRetries = 5;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

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

  // AI 분석 기능
  const analyzeImage = async () => {
    if (!formData.image) return;
    setIsAnalyzing(true);
    try {
      const base64Data = formData.image.split(',')[1];
      const payload = {
        contents: [{
          parts: [
            { text: "이 쓰레기 사진을 분석해줘. 결과는 반드시 JSON 형식으로만 보내줘. 'category'는 (cup, smoke, plastic, bulky, etc) 중 하나여야 하고, 'description'은 이 쓰레기가 환경에 미치는 영향과 함께 한국어로 친절하게 1문장으로 적어줘." },
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

  // AI 응원 메시지 생성
  const updateAiMessage = async () => {
    setIsGeneratingMsg(true);
    try {
      const solvedCount = reports.filter(r => r.status === 'solved').length;
      const payload = {
        contents: [{
          parts: [{ text: `현재 금정구 활동가들이 총 ${reports.length}개의 쓰레기를 찾았고 ${solvedCount}개를 해결했어. 활동가들에게 동기부여를 주는 짧고 따뜻한 응원 메시지를 한국어로 1문장 생성해줘.` }]
        }]
      };
      const result = await callGemini(payload);
      setAiMessage(result.candidates?.[0]?.content?.parts?.[0]?.text || aiMessage);
    } catch (e) {
      console.error("AI Message generation failed", e);
    } finally {
      setIsGeneratingMsg(false);
    }
  };

  // Firebase 초기 인증 (토큰 불일치 오류 해결을 위한 Fallback 로직)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
          } catch (tokenError) {
            console.warn("Custom token failed, falling back to anonymous auth.", tokenError);
            await signInAnonymously(auth);
          }
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { 
        console.error("Authentication failed:", e); 
      }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, setUser);
    return () => unsubscribeAuth();
  }, []);

  // Firestore 실시간 데이터 동기화
  useEffect(() => {
    if (!user) return;
    
    // 규칙 기반 경로: /artifacts/{appId}/public/data/reports
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    
    const unsubscribeData = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      })).sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      
      setReports(formatted);
      updateMarkers(formatted);
    }, (error) => {
      console.error("Firestore Listen Error:", error);
    });

    return () => unsubscribeData();
  }, [user, nickname]);

  // 지도 라이브러리 로드
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; 
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);

    if (!document.getElementById('tailwind-cdn')) {
      const tw = document.createElement('script');
      tw.id = 'tailwind-cdn'; tw.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(tw);
    }

    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        if (reports.length > 0) updateMarkers(reports);
      }, 300);
    }
    if (activeTab === 'stats' && reports.length > 0) updateAiMessage();
  }, [isScriptLoaded, activeTab]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const isMine = report.userName === nickname;
      const iconHtml = `<div style="background-color:${cat.color}; width:36px; height:36px; border-radius:12px; border:3px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 15px rgba(0,0,0,0.2); transform:rotate(45deg);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [36, 36], iconAnchor: [18, 18] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<div style="font-family:sans-serif; min-width:160px; padding:4px;"><b>${cat.icon} ${cat.label}</b><br/><small style="color:#64748b">활동가: ${report.userName}</small></div>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleLogout = async () => {
    if (window.confirm("로그아웃하시겠습니까? 닉네임 정보가 초기화됩니다.")) {
      localStorage.removeItem('team_nickname');
      setNickname('');
      setIsSettingNickname(true);
      await signOut(auth);
    }
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
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  const toggleStatus = async (report) => {
    if (!user) return;
    const reportRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', report.id);
    await updateDoc(reportRef, {
      status: report.status === 'pending' ? 'solved' : 'pending'
    });
  };

  const handleDelete = async (id) => {
    if (!user) return;
    if (window.confirm("기록을 삭제할까요?")) {
      const reportRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', id);
      await deleteDoc(reportRef);
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

  if (isSettingNickname) {
    return (
      <div className="h-screen w-screen bg-[#f0fdf4] flex flex-col items-center justify-center p-8 font-sans">
        <div className="bg-emerald-600 w-24 h-24 rounded-[32px] flex items-center justify-center mb-8 shadow-2xl rotate-12">
          <Navigation size={48} className="text-white" fill="currentColor" />
        </div>
        <h1 className="text-5xl font-black text-slate-800 tracking-tighter mb-2 italic uppercase text-center">Four Seasons</h1>
        <p className="text-emerald-600 font-bold text-xs tracking-[0.4em] mb-12">RUN & MAP GEUMJEONG</p>
        <div className="bg-white p-10 rounded-[50px] shadow-2xl w-full max-w-sm border border-white text-center">
          <h2 className="text-2xl font-black text-slate-800 mb-2">반가워요!</h2>
          <p className="text-slate-400 text-sm mb-10 leading-relaxed">우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 적어주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="예: 금정_철수" className="w-full p-5 rounded-3xl bg-emerald-50 border-none outline-none font-bold text-center text-xl text-emerald-800 mb-6 shadow-inner" autoFocus />
            <button className="w-full bg-emerald-600 text-white font-black py-5 rounded-3xl shadow-xl active:scale-95 transition-all text-lg flex items-center justify-center gap-2">지도 합류하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#f0fdf4] font-sans text-slate-900 overflow-hidden">
      <header className="bg-white/90 backdrop-blur-md p-4 px-6 border-b border-emerald-100 flex justify-between items-center z-[1000] sticky top-0">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg"><Navigation size={18} fill="currentColor"/></div>
          <h1 className="text-sm font-black text-slate-800 uppercase tracking-tighter">Four Seasons</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 px-3 py-1.5 rounded-full font-bold text-[11px] text-emerald-700">{nickname} 활동가</div>
          <button onClick={handleLogout} className="p-2 bg-slate-100 rounded-xl text-slate-400 active:bg-slate-200 transition-colors shadow-sm"><LogOut size={16}/></button>
        </div>
      </header>

      <main className="flex-1 relative">
        {/* Tab 1: Map */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'map' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute bottom-28 left-4 right-4 z-[1001]">
            <div className="bg-white p-5 rounded-[40px] shadow-2xl flex justify-between items-center border border-emerald-50">
               <div className="flex gap-6 pl-4">
                 <div className="text-center"><p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest italic">Trash</p><p className="text-2xl font-black text-slate-800">{reports.length}</p></div>
                 <div className="text-center border-l border-slate-100 pl-6"><p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest italic">Solved</p><p className="text-2xl font-black text-emerald-600">{reports.filter(r => r.status === 'solved').length}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} className="bg-slate-900 text-white px-6 py-4 rounded-[24px] text-sm font-black flex items-center gap-2 shadow-xl active:scale-90 transition-all"><PlusCircle size={20}/> 기록하기</button>
            </div>
          </div>
        </div>

        {/* Tab 2: New Record */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-50 transition-transform duration-500 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="max-w-md mx-auto pb-32">
            <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 italic uppercase tracking-tight">New Record</h2><button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-300 shadow-sm"><X/></button></div>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 p-6 rounded-[32px] text-white flex flex-col justify-between shadow-xl min-h-[140px]">
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2"><MapPin size={14}/> GPS Location</span>
                  <button type="button" onClick={getGPS} className={`px-4 py-3 rounded-2xl text-[10px] font-black transition-all ${formData.customLocation ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'}`}>{isLocating ? <Loader2 className="animate-spin" size={14}/> : "위치 잡기"}</button>
                </div>
                <div className="relative">
                  <input type="file" accept="image/*" onChange={(e) => {
                    const reader = new FileReader();
                    reader.onload = () => setFormData({...formData, image: reader.result});
                    reader.readAsDataURL(e.target.files[0]);
                  }} className="hidden" id="photo" />
                  <label htmlFor="photo" className={`cursor-pointer w-full h-[140px] rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center gap-2 bg-white transition-all ${formData.image ? 'border-emerald-500' : 'border-emerald-100'}`}>
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover rounded-[30px]" /> : <Camera size={24} className="text-emerald-500"/>}
                  </label>
                </div>
              </div>

              {formData.image && (
                <button type="button" onClick={analyzeImage} disabled={isAnalyzing} className="w-full bg-emerald-100 text-emerald-700 font-black py-5 rounded-[28px] flex items-center justify-center gap-2 border border-emerald-200 active:scale-95 transition-all shadow-md shadow-emerald-200/50">
                  {isAnalyzing ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18}/>}
                  {isAnalyzing ? "AI 분석 중..." : "AI 쓰레기 자동 분석"}
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-4 rounded-3xl border-2 flex items-center gap-4 transition-all ${formData.category === c.id ? 'border-emerald-500 bg-white text-emerald-700 shadow-md' : 'border-transparent bg-white text-slate-400 opacity-60'}`}>
                    <span className="text-2xl">{c.icon}</span><span className="text-xs font-black">{c.label}</span>
                  </button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요?" className="w-full p-6 bg-white rounded-[32px] h-36 text-sm font-medium outline-none border border-emerald-50 focus:ring-2 ring-emerald-400 shadow-sm" />
              <button className="w-full bg-emerald-600 text-white font-black py-6 rounded-[32px] shadow-2xl text-lg active:scale-95 transition-all">지도에 업로드</button>
            </form>
          </div>
        </div>

        {/* Tab 3: Feed */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-20 transition-transform duration-500 ${activeTab === 'list' ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="max-w-md mx-auto pb-32">
            <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 italic uppercase">Team Feed</h2><button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-300 shadow-sm"><X/></button></div>
            {reports.length === 0 ? <div className="text-center py-20 font-bold text-slate-300">아직 기록이 없습니다.</div> : reports.map(r => (
              <div key={r.id} className="bg-white p-6 rounded-[40px] mb-6 shadow-md border border-emerald-50 overflow-hidden relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3"><span className="text-3xl p-2 bg-emerald-50 rounded-2xl">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div><h4 className="font-black text-slate-800 text-sm">{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4><p className="text-[10px] font-bold text-slate-400 uppercase">{new Date(r.discoveredTime).toLocaleString()}</p></div>
                  </div>
                  <button onClick={() => toggleStatus(r)} className={`px-4 py-2 rounded-2xl text-[10px] font-black transition-all ${r.status === 'solved' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="w-full h-56 object-cover rounded-[32px] mb-4 shadow-inner border border-emerald-50" />}
                <p className="text-sm font-medium text-slate-600 bg-emerald-50/50 p-5 rounded-[28px] italic leading-relaxed border-l-4 border-emerald-400 shadow-sm">{r.description || "설명 없음"}</p>
                <div className="flex items-center justify-between pt-4 border-t border-emerald-50 mt-4">
                  <span className="text-[11px] font-black text-slate-600 flex items-center gap-1"><User size={12}/> {r.userName} 활동가</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[9px] bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full font-black border border-emerald-100 uppercase tracking-widest">{r.area}</span>
                    {r.userName === nickname && <button onClick={() => handleDelete(r.id)} className="text-red-300 p-2 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab 4: Stats */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-30 transition-transform duration-500 ${activeTab === 'stats' ? 'translate-x-0' : 'translate-x-full'}`}>
           <div className="max-w-md mx-auto pb-32">
            <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 italic uppercase">Team Stats</h2><button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-300 shadow-sm"><X/></button></div>
            
            <div className="bg-slate-900 rounded-[40px] p-8 text-white mb-8 shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={120} fill="white"/></div>
               <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-[0.3em] mb-4">
                 <Sparkles size={14}/> AI Eco Counselor
               </div>
               <p className="text-xl font-bold leading-relaxed italic relative z-10">
                 {isGeneratingMsg ? "AI가 지도를 분석하고 있습니다..." : `"${aiMessage}"`}
               </p>
               <div className="mt-8">
                  <div className="flex justify-between mb-2">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Clean Achievement</span>
                    <span className="text-[10px] font-black text-emerald-400">{reports.length > 0 ? Math.round((reports.filter(r => r.status === 'solved').length / reports.length) * 100) : 0}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-emerald-900/50 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-all duration-1000" style={{width: `${reports.length > 0 ? (reports.filter(r => r.status === 'solved').length / reports.length) * 100 : 0}%`}}></div>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-10">
               <div className="bg-white p-7 rounded-[32px] shadow-md border border-emerald-50 text-center">
                 <p className="text-[10px] font-black text-slate-300 mb-2 uppercase italic tracking-widest">Reports</p>
                 <p className="text-4xl font-black text-slate-800 tracking-tighter">{reports.length}</p>
               </div>
               <div className="bg-white p-7 rounded-[32px] shadow-md border border-emerald-50 text-center">
                 <p className="text-[10px] font-black text-slate-300 mb-2 uppercase italic tracking-widest">Solved</p>
                 <p className="text-4xl font-black text-emerald-600 tracking-tighter">{reports.filter(r => r.status === 'solved').length}</p>
               </div>
            </div>

            <h4 className="text-lg font-black mb-6 flex items-center gap-2 text-slate-800 italic uppercase">Trash Analytics <Award size={18} className="text-emerald-500"/></h4>
            <div className="space-y-4">
              {TRASH_CATEGORIES.map(cat => {
                const count = reports.filter(r => r.category === cat.id).length;
                const percent = reports.length > 0 ? (count / reports.length) * 100 : 0;
                return (
                  <div key={cat.id} className="bg-white p-5 rounded-[28px] shadow-sm border border-emerald-50">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-sm flex items-center gap-2">{cat.icon} {cat.label}</span>
                      <span className="text-xs font-black text-slate-400">{count}건</span>
                    </div>
                    <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                      <div className="h-full transition-all duration-1000" style={{width: `${percent}%`, backgroundColor: cat.color}}></div>
                    </div>
                  </div>
                );
              })}
            </div>
           </div>
        </div>
      </main>

      <nav className="bg-white/95 backdrop-blur-2xl border-t border-emerald-50 p-6 pb-10 flex justify-around items-center z-[2000] sticky bottom-0 shadow-[0_-15px_35px_rgba(16,185,129,0.08)]">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'map' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={activeTab === 'map' ? 3 : 2}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Map</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'list' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <List size={26} strokeWidth={activeTab === 'list' ? 3 : 2}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Feed</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'stats' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={26} strokeWidth={activeTab === 'stats' ? 3 : 2}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Stats</span>
        </button>
      </nav>

      <style>{`.leaflet-container { font-family: inherit; z-index: 1 !important; background: #f0fdf4; }.leaflet-popup-content-wrapper { border-radius: 28px; padding: 8px; box-shadow: 0 15px 35px rgba(16,185,129,0.15); border: 1px solid #f0fdf4; }.custom-pin { background: none; border: none; }::-webkit-scrollbar { width: 0px; background: transparent; }`}</style>
    </div>
  );
}