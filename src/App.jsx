import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
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
  ShieldCheck
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 데이지 앱 로직 기반 완전 안정화 버전]
 * 1. 닉네임창: "금정_이름" 가이드가 잘리지 않는 넓은 입력창 (데이지 스타일 UI)
 * 2. 지도 표시: 입장 즉시 지도 렌더링 (데이지의 지연 로딩 로직 적용)
 * 3. 데이터 오류: 모든 작업 전 강제 인증 로직 추가 (Rule 3 준수)
 * 4. 관리자 모드: admin 로그인 시 지도 및 삭제 권한 완전 복구
 */

const firebaseConfig = {
  apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
  authDomain: "fourseason-run-and-map.firebaseapp.com",
  projectId: "fourseason-run-and-map",
  storageBucket: "fourseason-run-and-map.firebasestorage.app",
  messagingSenderId: "671510183044",
  appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
  databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
};

// 고유 앱 아이디 (경로 충돌 방지를 위해 v16 안정화 버전으로 설정)
const appId = 'fourseason-run-and-map-v16-stable'; 
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
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // [핵심] 인증 보장 함수 (데이지 앱의 안정성 이식)
  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      const res = await signInAnonymously(auth);
      return res.user;
    } catch (err) {
      console.error("Auth Fail:", err);
      throw new Error("네트워크 인증에 실패했습니다.");
    }
  };

  // 1. 초기 인증 처리
  useEffect(() => {
    ensureAuth().catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 데이터 실시간 수신
  useEffect(() => {
    if (!user) return;
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    }, (err) => console.error("Firestore Error:", err));
    return () => unsubscribe();
  }, [user]);

  // 3. 지도 라이브러리 로드
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // 4. 지도 초기화 및 크기 보정 (데이지 스타일 로직)
  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMap.current) {
        setTimeout(() => {
          if (!mapContainerRef.current) return;
          leafletMap.current = window.L.map(mapContainerRef.current, { 
            zoomControl: false, attributionControl: false 
          }).setView(GEUMJEONG_CENTER, 14);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
          updateMarkers(reports);
          setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 400);
        }, 300);
      } else {
        setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 300);
      }
    }
  }, [isScriptLoaded, activeTab, nickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const pinColor = isAdmin ? '#ef4444' : (report.userName === nickname ? '#10b981' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      await ensureAuth(); // 저장 전 강제 인증 체크
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, { ...formData, location: loc, userName: nickname, discoveredTime: new Date().toISOString() });
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("지도에 성공적으로 업로드되었습니다! 🏁");
    } catch (err) { alert("기록 실패: 권한이 없습니다."); } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      await ensureAuth();
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
      alert("삭제되었습니다.");
    } catch (e) { alert("삭제 실패"); }
  };

  const clearAllData = async () => {
    if (!isAdmin) return;
    if (window.confirm("🚨 관리자 경고: 모든 데이터를 초기화하시겠습니까?")) {
      try {
        await ensureAuth();
        const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snap = await getDocs(coll);
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        alert("모든 기록이 초기화되었습니다.");
      } catch (err) { alert("초기화 실패"); }
    }
  };

  // 닉네임 입력 화면 (UI 개선)
  if (!nickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-6 z-[9999]">
        <div className="mb-10 text-center w-full">
          <div className="bg-[#10b981] w-[80px] h-[80px] rounded-[24px] flex items-center justify-center mx-auto mb-6 shadow-xl transform rotate-12">
            <Navigation size={45} color="white" fill="white" />
          </div>
          <h1 className="text-4xl font-black text-[#1e293b] mb-4">FOUR SEASONS</h1>
          <p className="text-sm font-black text-[#10b981] tracking-widest mb-10 uppercase">Run & Map Geumjeong</p>
        </div>
        <div className="bg-white p-10 rounded-[40px] w-full max-w-[420px] text-center shadow-2xl border border-green-50">
          <h2 className="text-2xl font-black text-[#1e293b] mb-2">활동가 합류</h2>
          <p className="text-sm text-[#64748b] mb-8">우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); const v = e.target.nick.value; if(v.trim()){ localStorage.setItem('team_nickname', v); setNickname(v); } }}>
            <input 
              name="nick"
              type="text" 
              placeholder="예시: 금정_이름" 
              className="w-full p-5 rounded-2xl bg-[#f8fafc] border-2 border-[#e2e8f0] text-center font-bold text-xl mb-6 outline-none focus:border-[#10b981] transition-all" 
              autoFocus 
            />
            <button type="submit" className="w-full bg-[#10b981] text-white font-black rounded-2xl p-5 text-xl shadow-lg flex items-center justify-center gap-2 hover:bg-[#059669] active:scale-95 transition-all">지도 합류하기 <ChevronRight size={24}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedCount = reports.filter(r => r.status === 'solved').length;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans">
      <header className="h-[70px] bg-white border-b border-[#d1fae5] flex items-center justify-between px-6 z-[1000]">
        <div className="flex items-center gap-2">
          <div className="bg-[#10b981] p-1.5 rounded-lg text-white">
            {isAdmin ? <ShieldCheck size={18}/> : <Navigation size={18}/>}
          </div>
          <span className="text-base font-black text-[#1e293b]">FOUR SEASONS</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-black bg-[#f0fdf4] text-[#047857] px-4 py-1.5 rounded-full border border-[#d1fae5]">{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")){ localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); } }} className="p-2 bg-slate-50 rounded-xl text-slate-400 active:scale-90 transition-transform"><LogOut size={18}/></button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Tab 1: 지도 */}
        <div className={`absolute inset-0 z-10 ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <button onClick={() => setActiveTab('add')} className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white font-black px-12 py-5 rounded-full z-[1001] shadow-2xl active:scale-95 transition-transform text-lg">기록하기 +</button>
        </div>

        {/* Tab 2: 추가 */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto z-[2000] transition-transform duration-300 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black text-[#1e293b]">NEW RECORD</h2>
            <button onClick={() => setActiveTab('map')} className="p-2 bg-white rounded-xl shadow-sm"><X size={24}/></button>
          </div>
          <form onSubmit={handleSave} className="flex flex-col gap-6">
             <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => { navigator.geolocation.getCurrentPosition(pos => setFormData(prev => ({ ...prev, customLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))); }} className="h-28 rounded-[32px] bg-[#1e293b] text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform shadow-lg">
                   <MapPin size={28} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span className="text-xs font-black">{formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <div className="h-28 rounded-[32px] bg-white border-2 border-dashed border-[#d1fae5] flex flex-col items-center justify-center gap-2 text-slate-300">
                   <Camera size={28}/><span className="text-xs font-black">사진 서비스 준비중</span>
                </div>
             </div>
             <div className="grid grid-cols-2 gap-3">
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-5 rounded-2xl border-2 flex items-center gap-3 transition-all ${formData.category === c.id ? 'border-[#10b981] bg-white shadow-inner scale-95' : 'border-transparent bg-white shadow-sm'}`}>
                   <span className="text-2xl">{c.icon}</span><span className="text-xs font-black">{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." className="p-6 rounded-[32px] h-36 border-2 border-[#e2e8f0] outline-none resize-none focus:border-[#10b981] text-base" />
             <button disabled={isUploading} className="bg-[#10b981] text-white p-6 rounded-[32px] font-black text-xl shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform mt-2">
               {isUploading ? <Loader2 className="animate-spin" size={24}/> : "지도에 업로드"}
             </button>
          </form>
        </div>

        {/* Tab 3: 피드 */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'list' ? 'visible' : 'hidden'}`}>
           <h2 className="text-2xl font-black text-[#1e293b] mb-8">ACTIVITY FEED</h2>
           {reports.length === 0 ? <div className="text-center py-24 text-slate-400 font-black">기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} className="bg-white p-6 rounded-[36px] mb-5 border border-[#d1fae5] shadow-md">
                <div className="flex justify-between items-center mb-5">
                   <span className="text-sm font-black text-[#1e293b] flex items-center gap-2">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.userName}</span>
                   {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} className="p-1.5 text-red-200 hover:text-red-400 transition-colors"><Trash2 size={20}/></button>}
                </div>
                <p className="text-base text-slate-600 leading-relaxed font-semibold px-1">{r.description}</p>
             </div>
           ))}
        </div>

        {/* Tab 4: 통계 */}
        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'stats' ? 'visible' : 'hidden'}`}>
           <h2 className="text-2xl font-black text-[#1e293b] mb-8">ACTIVITY STATS</h2>
           <div className="bg-[#1e293b] p-12 rounded-[50px] text-center mb-6 shadow-2xl">
              <h3 className="text-6xl font-black text-white mb-2">{reports.length}</h3>
              <p className="text-xs font-black text-[#10b981] tracking-widest uppercase opacity-90">Total Trash Found</p>
           </div>
           <div className="grid grid-cols-2 gap-5 mb-12">
              <div className="bg-white p-8 rounded-[40px] text-center border border-green-50 shadow-lg"><p className="text-[11px] font-black text-slate-400 mb-2 uppercase">Success</p><p className="text-3xl font-black text-[#10b981]">{solvedCount}</p></div>
              <div className="bg-white p-8 rounded-[40px] text-center border border-green-50 shadow-lg"><p className="text-[11px] font-black text-slate-400 mb-2 uppercase">Pending</p><p className="text-3xl font-black text-slate-800">{reports.length - solvedCount}</p></div>
           </div>
           
           {isAdmin && (
             <div className="bg-white p-10 rounded-[50px] border-2 border-dashed border-red-100 text-center shadow-sm">
               <h4 className="text-red-500 font-black mb-3 flex items-center justify-center gap-2 text-lg"><AlertTriangle size={24}/> ADMIN ONLY</h4>
               <p className="text-xs text-slate-400 mb-8 font-black">전체 활동 기록을 초기화할 수 있습니다.</p>
               <button onClick={clearAllData} className="w-full bg-red-500 text-white p-5 rounded-[24px] font-black shadow-lg active:scale-95 transition-transform text-lg">모든 데이터 초기화</button>
             </div>
           )}
        </div>
      </main>

      {/* 하단 내비게이션 바 */}
      <nav className="h-[80px] bg-white border-t border-[#d1fae5] flex justify-around items-center px-4 pb-4 shadow-[0_-5px_20px_rgba(0,0,0,0.02)]">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'map' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span className="text-[11px] font-black">지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'list' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <List size={26} strokeWidth={3}/>
          <span className="text-[11px] font-black">피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'stats' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={26} strokeWidth={3}/>
          <span className="text-[11px] font-black">통계</span>
        </button>
      </nav>
      
      <style>{`
        .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; border-radius: 0; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);