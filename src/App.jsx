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
  getDocs,
  writeBatch
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
  Loader2,
  CheckCircle2
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 최종 안정화 버전]
 * 1. 디자인: 연초록색(#f0fdf4) 테마를 모든 화면에 강력 적용
 * 2. GPS: 고정밀 수신 및 에러 핸들링 강화 (지도 업로드 연동 해결)
 * 3. 기능: 로그아웃 및 관리자 전용 전체 삭제 포함
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
  const [isUploading, setIsUploading] = useState(false);
  
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

  // 1. 인증 및 상태 관리
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else { await signInAnonymously(auth); }
      } catch (e) { console.error(e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신
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
  }, [user, nickname]);

  // 3. 라이브러리 로드
  useEffect(() => {
    if (!document.getElementById('tailwind-cdn')) {
      const tw = document.createElement('script');
      tw.id = 'tailwind-cdn'; tw.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(tw);
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  // 4. 지도 렌더링
  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { 
          zoomControl: false, 
          attributionControl: false,
          maxZoom: 18
        }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        updateMarkers(reports);
      }, 300);
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
      const iconHtml = `<div style="background-color:${cat.color}; width:32px; height:32px; border-radius:10px; border:2px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:18px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>기록: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      localStorage.removeItem('team_nickname');
      setNickname('');
      setIsSettingNickname(true);
      signOut(auth);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return alert("인증 대기 중입니다...");
    
    // GPS 값이 없으면 지도 중심점을 대신 사용
    let loc = formData.customLocation;
    if (!loc) {
      if (leafletMap.current) {
        const center = leafletMap.current.getCenter();
        loc = { lat: center.lat, lng: center.lng };
      } else {
        loc = { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      }
    }

    setIsUploading(true);
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
      alert("지도로 기록이 공유되었습니다! 🏁");
    } catch (err) { 
      console.error(err);
      alert("업로드 실패! 다시 시도해주세요."); 
    } finally {
      setIsUploading(false);
    }
  };

  const getGPS = () => {
    setIsLocating(true);
    if (!navigator.geolocation) {
      alert("이 브라우저는 위치 정보를 지원하지 않습니다.");
      setIsLocating(false);
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFormData(prev => ({ ...prev, customLocation: newLoc }));
        setIsLocating(false);
        if (leafletMap.current) {
          leafletMap.current.setView([newLoc.lat, newLoc.lng], 16);
        }
      },
      (error) => { 
        setIsLocating(false); 
        console.error(error);
        alert("GPS 위치를 가져올 수 없습니다. 권한 허용 여부와 GPS 설정을 확인해 주세요. (지도의 중심점으로 업로드됩니다.)"); 
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const clearAllData = async () => {
    if (nickname !== 'admin') return;
    if (window.confirm("주의! 모든 활동 기록이 영구적으로 삭제됩니다. 계속하시겠습니까?")) {
      try {
        const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snapshot = await getDocs(reportsCollection);
        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        alert("모든 데이터가 성공적으로 초기화되었습니다.");
      } catch (err) { alert("삭제 실패: " + err.message); }
    }
  };

  // 닉네임 입력 화면 (연초록색 바탕 디자인 강력 적용)
  if (isSettingNickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-8 font-sans z-[9999]">
        <div className="bg-emerald-600 w-24 h-24 rounded-[32px] flex items-center justify-center mb-8 shadow-2xl rotate-12">
          <Navigation size={48} className="text-white" fill="currentColor" />
        </div>
        <h1 className="text-5xl font-black text-slate-800 tracking-tighter mb-2 italic uppercase text-center">Four Seasons</h1>
        <p className="text-emerald-600 font-bold text-xs tracking-[0.4em] mb-12 uppercase">Run & Map Geumjeong</p>
        <div className="bg-white p-10 rounded-[50px] shadow-2xl w-full max-w-sm border border-emerald-50 text-center">
          <h2 className="text-2xl font-black text-slate-800 mb-2">반가워요 활동가님!</h2>
          <p className="text-slate-400 text-sm mb-10 leading-relaxed">우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="닉네임 입력" className="w-full p-5 rounded-3xl bg-[#f0fdf4] border-none outline-none font-bold text-center text-xl text-emerald-800 mb-6 shadow-inner" autoFocus />
            <button className="w-full bg-emerald-600 text-white font-black py-5 rounded-3xl shadow-xl active:scale-95 transition-all text-lg flex items-center justify-center gap-2">지도 합류하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedCount = reports.filter(r => r.status === 'solved').length;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans text-slate-900 overflow-hidden select-none">
      {/* 헤더 */}
      <header className="bg-white/95 backdrop-blur-md p-4 px-6 border-b border-emerald-100 flex justify-between items-center z-[1000] shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg shadow-emerald-200/50"><Navigation size={18} fill="currentColor"/></div>
          <h1 className="text-sm font-black text-slate-800 uppercase tracking-tighter">Four Seasons</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-[#f0fdf4] px-4 py-1.5 rounded-full font-bold text-[11px] text-emerald-700 border border-emerald-100 shadow-sm">{nickname}</div>
          <button onClick={handleLogout} className="p-2 bg-slate-100 rounded-xl text-slate-400 active:bg-slate-200 transition-colors shadow-sm" title="로그아웃">
            <LogOut size={16}/>
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Tab 1: Map */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'map' ? 'opacity-100 z-10' : 'opacity-0 z-0 invisible'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute bottom-6 left-4 right-4 z-[1001]">
            <div className="bg-white p-5 rounded-[40px] shadow-2xl flex justify-between items-center border border-emerald-50">
               <div className="flex gap-6 pl-4">
                 <div className="text-center"><p className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic">Found</p><p className="text-2xl font-black text-slate-800">{reports.length}</p></div>
                 <div className="text-center border-l border-slate-100 pl-6"><p className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic">Solved</p><p className="text-2xl font-black text-emerald-600">{solvedCount}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} className="bg-slate-900 text-white px-7 py-4 rounded-[24px] text-sm font-black flex items-center gap-2 shadow-xl active:scale-90 transition-all"><PlusCircle size={20}/> 기록하기</button>
            </div>
          </div>
        </div>

        {/* Tab 2: New Record Overlay */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-50 transition-transform duration-500 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="max-w-md mx-auto pb-32">
            <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 italic uppercase">New Record</h2><button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-300 shadow-sm"><X/></button></div>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 p-6 rounded-[32px] text-white flex flex-col justify-between shadow-xl min-h-[140px]">
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-1"><MapPin size={14}/> Location</span>
                  <button type="button" onClick={getGPS} className={`w-full py-3 rounded-2xl text-[11px] font-black transition-all ${formData.customLocation ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'}`}>{isLocating ? <Loader2 className="animate-spin mx-auto" size={14}/> : formData.customLocation ? "수신 완료" : "위치 잡기"}</button>
                </div>
                <div className="relative">
                  <input type="file" accept="image/*" onChange={(e) => { if(e.target.files[0]){ const reader = new FileReader(); reader.onload = () => setFormData({...formData, image: reader.result}); reader.readAsDataURL(e.target.files[0]); }}} className="hidden" id="photo" />
                  <label htmlFor="photo" className={`cursor-pointer w-full h-[140px] rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center gap-2 bg-white transition-all ${formData.image ? 'border-emerald-500' : 'border-emerald-100'}`}>
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover rounded-[30px]" /> : (
                      <div className="text-center"><Camera size={24} className="text-emerald-500 mx-auto mb-1"/><span className="text-[10px] font-black text-emerald-600">사진 추가</span></div>
                    )}
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-4 rounded-3xl border-2 flex items-center gap-4 transition-all ${formData.category === c.id ? 'border-emerald-500 bg-white shadow-md scale-[1.02]' : 'border-transparent bg-white/50 text-slate-400'}`}>
                    <span className="text-2xl">{c.icon}</span><span className="text-xs font-black">{c.label}</span>
                  </button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요?" className="w-full p-6 bg-white rounded-[32px] h-36 text-sm font-medium outline-none border border-emerald-50 shadow-inner resize-none" />
              <button disabled={isUploading} className="w-full bg-emerald-600 text-white font-black py-6 rounded-[32px] shadow-2xl text-lg active:scale-95 transition-all disabled:bg-slate-400">
                {isUploading ? <Loader2 className="animate-spin mx-auto" /> : "지도에 업로드"}
              </button>
            </form>
          </div>
        </div>

        {/* Tab 3: Feed */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-20 transition-transform duration-500 ${activeTab === 'list' ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="max-w-md mx-auto pb-32">
            <div className="flex justify-between items-center mb-10"><h2 className="text-2xl font-black text-slate-800 italic uppercase tracking-tighter">Team Archive</h2><button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl text-slate-300 shadow-sm"><X/></button></div>
            {reports.length === 0 ? <div className="text-center py-20 font-bold text-slate-300 italic">아직 기록이 없습니다.</div> : reports.map(r => (
              <div key={r.id} className="bg-white p-6 rounded-[40px] mb-6 shadow-md border border-emerald-50 overflow-hidden relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3"><span className="text-3xl p-2 bg-[#f0fdf4] rounded-2xl">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div><h4 className="font-black text-slate-800 text-[13px]">{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4><p className="text-[9px] font-bold text-slate-400">{new Date(r.discoveredTime).toLocaleString()}</p></div>
                  </div>
                  <button onClick={() => { updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' }); }} className={`px-4 py-2 rounded-2xl text-[10px] font-black transition-all ${r.status === 'solved' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="w-full h-56 object-cover rounded-[32px] mb-4 shadow-inner border border-emerald-50" />}
                <p className="text-[13px] font-medium text-slate-600 bg-[#f0fdf4]/50 p-5 rounded-[28px] italic leading-relaxed border-l-4 border-emerald-400 mb-4">{r.description || "설명 없음"}</p>
                <div className="flex items-center justify-between pt-4 border-t border-emerald-50">
                  <span className="text-[10px] font-black text-slate-600 flex items-center gap-1"><User size={12}/> {r.userName} 활동가</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[9px] bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full font-black border border-emerald-100 uppercase tracking-widest">{r.area}</span>
                    {(r.userName === nickname || nickname === 'admin') && <button onClick={() => { if(window.confirm("기록을 삭제할까요?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id)); }} className="text-red-300 p-2 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>}
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
               <div className="absolute top-0 right-0 p-4 opacity-10"><BarChart3 size={120} fill="white"/></div>
               <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-widest mb-4">TEAM ACHIEVEMENT</div>
               <h3 className="text-4xl font-black mb-1 tracking-tighter">{reports.length > 0 ? Math.round((solvedCount / reports.length) * 100) : 0}%</h3>
               <p className="text-slate-400 text-xs font-medium italic">우리 팀의 활약으로 지구가 조금씩 더 깨끗해지고 있어요!</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
               <div className="bg-white p-8 rounded-[35px] border border-emerald-50 text-center shadow-sm">
                 <p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest">Total Found</p>
                 <p className="text-4xl font-black text-slate-800">{reports.length}</p>
               </div>
               <div className="bg-white p-8 rounded-[35px] border border-emerald-50 text-center shadow-sm">
                 <p className="text-[9px] font-black text-slate-300 mb-1 uppercase tracking-widest">Team Solved</p>
                 <p className="text-4xl font-black text-emerald-600">{solvedCount}</p>
               </div>
            </div>

            {nickname === 'admin' && (
              <div className="mt-10 p-8 bg-white rounded-[40px] border-2 border-dashed border-red-100">
                <h4 className="text-red-700 font-black mb-2 flex items-center gap-2"><AlertTriangle size={18}/> 관리자 전용 도구</h4>
                <p className="text-slate-400 text-[11px] mb-6 font-medium">데이터를 한꺼번에 지우려면 아래 버튼을 누르세요.</p>
                <button onClick={clearAllData} className="w-full bg-red-500 text-white font-black py-5 rounded-3xl shadow-xl active:bg-red-600 transition-all flex items-center justify-center gap-2">
                   기록 전체 초기화
                </button>
              </div>
            )}
           </div>
        </div>
      </main>

      <nav className="bg-white/95 backdrop-blur-2xl border-t border-emerald-100 p-6 pb-10 flex justify-around items-center z-[2000] shadow-[0_-10px_30px_rgba(0,0,0,0.03)]">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'map' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Map</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'list' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <List size={26} strokeWidth={3}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Feed</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'stats' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={26} strokeWidth={3}/>
          <span className="text-[10px] font-black uppercase tracking-tighter">Stats</span>
        </button>
      </nav>

      <style>{`
        .leaflet-container { z-index: 1 !important; background: #f0fdf4 !important; }
        .leaflet-popup-content-wrapper { border-radius: 28px; padding: 8px; box-shadow: 0 15px 35px rgba(16,185,129,0.15); border: 1px solid #f0fdf4; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; background: transparent; }
        input, textarea, select { font-family: inherit; }
        body { background-color: #f0fdf4; margin: 0; padding: 0; }
      `}</style>
    </div>
  );
}