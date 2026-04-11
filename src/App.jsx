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
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  MapPin, 
  BarChart3, 
  List, 
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
 * [사계절 런앤맵 - 데이지 앱 구조 기반 긴급 복구본]
 * 1. 구조: 가장 안정적인 데이지 앱의 단일 파일 렌더링 구조 이식
 * 2. 디자인: 사계절 팀 요청 반영 (연녹색 테마 + 네잎클로버 아이콘)
 * 3. 로그인 가이드: "예시: 금정_이름" 적용
 * 4. 지도 로딩: 탭 전환 및 입장 시 자동 크기 보정 기능 포함
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

const appId = 'fourseason-run-and-map-daisy-base-v1'; 
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

// 네잎클로버 아이콘 디자인 (데이지 꽃 디자인 구조 계승)
const CloverIcon = ({ size = 40, color = "#10b981" }) => (
  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: `${size}px`, height: `${size}px` }}>
    <svg viewBox="0 0 100 100" style={{ position: 'absolute', width: '100%', height: '100%' }}>
      <path d="M50 50C50 30 35 20 22 20C9 20 0 30 0 50C0 70 9 80 22 80C35 80 50 70 50 50Z" fill={color} />
      <path d="M50 50C70 50 80 35 80 22C80 9 70 0 50 0C30 0 20 9 20 22C20 35 30 50 50 50Z" fill={color} />
      <path d="M50 50C50 70 65 80 78 80C91 80 100 70 100 50C100 30 91 20 78 20C65 20 50 30 50 50Z" fill={color} />
      <path d="M50 50C30 50 20 65 20 78C20 91 30 100 50 100C70 100 80 91 80 78C80 65 70 50 50 50Z" fill={color} />
      <circle cx="50" cy="50" r="8" fill="white" opacity="0.4" />
    </svg>
  </div>
);

function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // 1. 인증 초기화
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신
  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime).getTime() - new Date(a.discoveredTime).getTime());
      setReports(data);
      updateMarkers(data);
    });
    return () => unsubscribe();
  }, [user, nickname]);

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

  // 4. 지도 초기화 및 보정
  useEffect(() => {
    if (isScriptLoaded && !isSettingNickname && activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMap.current) {
        setTimeout(() => {
          if (!mapContainerRef.current) return;
          leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView(GEUMJEONG_CENTER, 14);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
          updateMarkers(reports);
        }, 300);
      } else { 
        setTimeout(() => { if(leafletMap.current) leafletMap.current.invalidateSize(); }, 300);
      }
    }
  }, [isScriptLoaded, activeTab, isSettingNickname]);

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
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, { ...formData, location: loc, userName: nickname, discoveredTime: new Date().toISOString() });
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("지도에 성공적으로 업로드되었습니다! 🍀");
    } catch (err) { alert("실패!"); } finally { setIsUploading(false); }
  };

  if (isSettingNickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', zIndex: 9999 }}>
        <div style={{ marginBottom: '40px', textAlign: 'center' }}>
          <div style={{ backgroundColor: '#10b981', width: '80px', height: '80px', borderRadius: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', transform: 'rotate(8deg)', boxShadow: '0 10px 20px rgba(16,185,129,0.2)' }}>
            <CloverIcon size={55} color="white" />
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', margin: '0 0 8px 0', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
          <p style={{ fontSize: '0.9rem', fontWeight: '700', color: '#10b981', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Run & Map Geumjeong</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '40px 30px', borderRadius: '45px', width: '100%', maxWidth: '360px', textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '900', color: '#1e293b', marginBottom: '10px' }}>활동가 합류</h2>
          <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '30px', lineHeight: '1.5' }}>우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="예시: 금정_이름" style={{ width: '100%', padding: '18px', borderRadius: '20px', backgroundColor: '#f8fafc', border: '2px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '24px', outline: 'none' }} autoFocus />
            <button type="submit" style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '20px', fontSize: '1.2rem', cursor: 'pointer', boxShadow: '0 10px 15px rgba(16,185,129,0.3)' }}>지도 합류하기 <ChevronRight size={24} style={{verticalAlign:'middle'}}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: 'sans-serif' }}>
      <header style={{ height: '70px', backgroundColor: 'white', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CloverIcon size={25} />
          <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ backgroundColor: '#f0fdf4', color: '#047857', fontWeight: '900', fontSize: '11px', padding: '5px 14px', borderRadius: '20px', border: '1px solid #d1fae5' }}>{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")){ localStorage.removeItem('team_nickname'); setNickname(''); setIsSettingNickname(true); signOut(auth); } }} style={{ border: 'none', background: '#f8fafc', padding: '8px', borderRadius: '12px', color: '#94a3b8' }}><LogOut size={18}/></button>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Tab 1: 지도 */}
        <div style={{ position: 'absolute', inset: 0, visibility: activeTab === 'map' ? 'visible' : 'hidden', zIndex: 10 }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          <button onClick={() => setActiveTab('add')} style={{ position: 'absolute', bottom: '30px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '50px', padding: '18px 40px', zIndex: 1001, boxShadow: '0 10px 25px rgba(0,0,0,0.2)', fontSize: '1.1rem' }}>기록하기 +</button>
        </div>

        {/* Tab 2: 추가 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', display: activeTab === 'add' ? 'block' : 'none', padding: '24px', overflowY: 'auto', zIndex: 2000 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
             <h2 style={{ fontSize: '1.6rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>NEW RECORD</h2>
             <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'white', padding: '10px', borderRadius: '15px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}><X/></button>
           </div>
           <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} style={{ padding: '18px', borderRadius: '20px', border: '2px solid #e2e8f0', backgroundColor: 'white', fontWeight: 'bold', fontSize: '1rem', outline: 'none' }}>
               {GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
             </select>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{ padding: '16px', borderRadius: '20px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', background: 'white', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px' }}>
                   <span style={{fontSize:'1.4rem'}}>{c.icon}</span><span style={{fontSize:'0.85rem'}}>{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." style={{ padding: '20px', borderRadius: '25px', height: '120px', border: '2px solid #e2e8f0', outline: 'none', resize: 'none', fontSize: '1rem' }} />
             <button disabled={isUploading} style={{ backgroundColor: '#10b981', color: 'white', padding: '20px', borderRadius: '25px', border: 'none', fontWeight: '900', fontSize: '1.2rem', boxShadow: '0 10px 15px rgba(16,185,129,0.3)' }}>
               {isUploading ? <Loader2 className="animate-spin" /> : "지도에 업로드"}
             </button>
           </form>
        </div>

        {/* Tab 3: 피드 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', display: activeTab === 'list' ? 'block' : 'none', padding: '24px', overflowY: 'auto' }}>
           <h2 style={{ fontSize: '1.6rem', fontWeight: '900', color: '#1e293b', marginBottom: '25px' }}>ACTIVITY FEED</h2>
           {reports.length === 0 ? <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontWeight: '700' }}>기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} style={{ background: 'white', padding: '24px', borderRadius: '35px', marginBottom: '20px', border: '1px solid #d1fae5', boxShadow: '0 5px 10px rgba(0,0,0,0.03)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                 <span style={{ fontWeight: '900', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span>
                 <button onClick={() => updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' })} style={{ border: 'none', padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: '900', backgroundColor: r.status === 'solved' ? '#10b981' : '#f8fafc', color: r.status === 'solved' ? 'white' : '#94a3b8' }}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
               </div>
               <p style={{ margin: '0 0 20px 0', fontSize: '15px', color: '#475569', lineHeight: '1.6', fontWeight: '500' }}>{r.description || "내용 없음"}</p>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '15px', borderTop: '1px solid #f1f5f9' }}>
                 <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '5px' }}><User size={14}/> {r.userName}</span>
                 {(r.userName === nickname || isAdmin) && <button onClick={() => { if(window.confirm("삭제하시겠습니까?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id)); }} style={{ border: 'none', background: 'none', color: '#fca5a5' }}><Trash2 size={18}/></button>}
               </div>
             </div>
           ))}
        </div>

        {/* Tab 4: 통계 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', display: activeTab === 'stats' ? 'block' : 'none', padding: '24px', overflowY: 'auto' }}>
           <h2 style={{ fontSize: '1.6rem', fontWeight: '900', color: '#1e293b', marginBottom: '25px' }}>ACTIVITY STATS</h2>
           <div style={{ backgroundColor: '#1e293b', borderRadius: '45px', padding: '50px 30px', color: 'white', textAlign: 'center', marginBottom: '25px', boxShadow: '0 15px 30px rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '4.5rem', fontWeight: '900', margin: '0 0 10px 0' }}>{reports.length}</h3>
              <p style={{ fontSize: '0.9rem', fontWeight: '900', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Total Trash Found</p>
           </div>
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ background:'white', padding:'30px 20px', borderRadius:'35px', textAlign:'center', border:'1px solid #f0fdf4' }}><p style={{fontSize:'12px', fontWeight:'900', color:'#94a3b8', marginBottom:'10px'}}>SOLVED</p><p style={{fontSize:'2rem', fontWeight:'900', color:'#10b981', margin:0}}>{solvedCount}</p></div>
              <div style={{ background:'white', padding:'30px 20px', borderRadius:'35px', textAlign:'center', border:'1px solid #f0fdf4' }}><p style={{fontSize:'12px', fontWeight:'900', color:'#94a3b8', marginBottom:'10px'}}>PENDING</p><p style={{fontSize:'2rem', fontWeight:'900', color:'#1e293b', margin:0}}>{reports.length - solvedCount}</p></div>
           </div>
        </div>
      </main>

      <nav style={{ height: '90px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: '25px', boxShadow: '0 -5px 15px rgba(0,0,0,0.02)' }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', color: activeTab === 'map' ? '#10b981' : '#cbd5e1' }}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/><span style={{ fontSize: '11px', fontWeight: '900' }}>지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', color: activeTab === 'list' ? '#10b981' : '#cbd5e1' }}>
          <List size={26} strokeWidth={3}/><span style={{ fontSize: '11px', fontWeight: '900' }}>피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{ border: 'none', background: 'none', display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', color: activeTab === 'stats' ? '#10b981' : '#cbd5e1' }}>
          <BarChart3 size={26} strokeWidth={3}/><span style={{ fontSize: '11px', fontWeight: '900' }}>통계</span>
        </button>
      </nav>
      <style>{` .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; } .custom-pin { background: none !important; border: none !important; } ::-webkit-scrollbar { width: 0px; } `}</style>
    </div>
  );
}

// ---------------------------------------------------------
// [핵심] 실제 화면에 앱을 그리는 렌더링 엔진 (데이지 구조)
// ---------------------------------------------------------
const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}