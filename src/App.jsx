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
  writeBatch,
  updateDoc
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
 * [사계절 런앤맵 - 최종 긴급 복구 버전]
 * 1. 스타일 완전 보장: Tailwind가 작동하지 않는 환경에서도 깨지지 않도록 인라인 스타일을 적용했습니다.
 * 2. 닉네임창: "예시: 금정_이름"이 충분히 보이도록 입력창 너비를 확장했습니다.
 * 3. 저장 실패 해결: 모든 DB 작업 전 실시간 강제 인증 로직(ensureAuth)을 적용했습니다.
 * 4. 지도 로딩: 입장 즉시 지도가 꽉 차게 보이도록 렌더링 타이밍을 최적화했습니다.
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

// 고유 앱 아이디 (데이터 꼬임 방지를 위해 v40으로 갱신)
const appId = 'fourseason-run-and-map-v40-stable'; 
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

  // [핵심] 인증 보장 함수: 모든 데이터베이스 명령 전 필수 실행
  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      const res = await signInAnonymously(auth);
      return res.user;
    } catch (err) {
      console.error("인증 실패:", err);
      throw new Error("네트워크 연결을 확인해주세요.");
    }
  };

  // 1. 초기 인증 처리
  useEffect(() => {
    ensureAuth().catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신
  useEffect(() => {
    if (!user) return;
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 지도 라이브러리 동적 로드
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // 4. 지도 초기화 및 크기 보정
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
          setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 500);
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
      await ensureAuth(); // 저장 전 강제 인증
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, { ...formData, location: loc, userName: nickname, discoveredTime: new Date().toISOString() });
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("성공적으로 업로드되었습니다! 🏁");
    } catch (err) { alert("저장 실패: 다시 시도해 주세요."); } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      await ensureAuth();
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
      alert("삭제되었습니다.");
    } catch (err) { alert("삭제 실패"); }
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

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFormData(prev => ({ ...prev, customLocation: coords }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([coords.lat, coords.lng], 16);
      },
      () => { setIsLocating(false); alert("GPS 수신 실패. 지도의 중심점이 기록됩니다."); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // 닉네임 입력 화면 (UI 완전 복구)
  if (!nickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', zIndex: 9999, fontFamily: 'sans-serif' }}>
        <div style={{ marginBottom: '40px', textAlign: 'center', width: '100%' }}>
          <div style={{ backgroundColor: '#10b981', width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)', transform: 'rotate(12deg)' }}>
            <Navigation size={45} color="white" fill="white" />
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '10px', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
          <p style={{ fontSize: '0.875rem', fontWeight: '700', color: '#10b981', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Run & Map Geumjeong</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '40px', width: '100%', maxWidth: '420px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.1)', border: '1px solid #f0fdf4' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '8px' }}>활동가 합류</h2>
          <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '32px', lineHeight: '1.5' }}>우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); const v = e.target.nick.value; if(v.trim()){ localStorage.setItem('team_nickname', v); setNickname(v); } }}>
            <input 
              name="nick"
              type="text" 
              placeholder="예시: 금정_이름" 
              style={{ width: '100%', padding: '18px', borderRadius: '20px', backgroundColor: '#f8fafc', border: '2px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '24px', outline: 'none', boxSizing: 'border-box' }} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '20px', fontSize: '1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.4)' }}>지도 합류하기 <ChevronRight size={24}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedCount = reports.filter(r => r.status === 'solved').length;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* 헤더 */}
      <header style={{ height: '70px', backgroundColor: 'white', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 1000, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ backgroundColor: isAdmin ? '#ef4444' : '#10b981', padding: '6px', borderRadius: '10px', color: 'white' }}>
            {isAdmin ? <ShieldCheck size={18}/> : <Navigation size={18}/>}
          </div>
          <span style={{ fontSize: '1rem', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: '900', backgroundColor: '#f0fdf4', color: '#047857', padding: '6px 14px', borderRadius: '20px', border: '1px solid #d1fae5' }}>{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")){ localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); } }} style={{ padding: '8px', backgroundColor: '#f8fafc', border: 'none', borderRadius: '12px', color: '#94a3b8', cursor: 'pointer' }}><LogOut size={18}/></button>
        </div>
      </header>

      {/* 메인 영역 - 탭에 따라 하나만 보이게 강제 설정 */}
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Tab 1: 지도 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'map' ? 'block' : 'none', zIndex: 10 }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          <button onClick={() => setActiveTab('add')} style={{ position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '50px', padding: '18px 40px', fontSize: '1.125rem', zIndex: 1001, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)', cursor: 'pointer' }}>기록하기 +</button>
        </div>

        {/* Tab 2: 추가 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'add' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>NEW RECORD</h2>
            <button onClick={() => setActiveTab('map')} style={{ padding: '10px', backgroundColor: 'white', border: 'none', borderRadius: '14px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', cursor: 'pointer' }}><X size={24}/></button>
          </div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <button type="button" onClick={getGPS} style={{ height: '110px', borderRadius: '32px', backgroundColor: '#1e293b', color: 'white', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                   <MapPin size={28} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span style={{ fontSize: '0.75rem', fontWeight: '900' }}>{isLocating ? "수신 중..." : formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <div style={{ height: '110px', borderRadius: '32px', backgroundColor: 'white', border: '2px dashed #d1fae5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#cbd5e1' }}>
                   <Camera size={28}/><span style={{ fontSize: '0.75rem', fontWeight: '900' }}>사진 준비중</span>
                </div>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} style={{ padding: '18px', borderRadius: '20px', border: '2px solid #e2e8f0', fontWeight: 'bold', fontSize: '1rem', outline: 'none', backgroundColor: 'white' }}>
                {GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
             </select>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{ padding: '18px', borderRadius: '20px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', backgroundColor: 'white', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', boxShadow: formData.category === c.id ? 'inset 0 2px 4px rgba(0,0,0,0.05)' : '0 2px 4px rgba(0,0,0,0.02)' }}>
                   <span style={{ fontSize: '1.5rem' }}>{c.icon}</span><span style={{ fontSize: '0.8rem', fontWeight: '900', color: '#1e293b' }}>{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." style={{ padding: '24px', borderRadius: '32px', height: '140px', border: '2px solid #e2e8f0', outline: 'none', resize: 'none', fontSize: '1rem', boxSizing: 'border-box' }} />
             <button disabled={isUploading} style={{ backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '32px', padding: '24px', fontSize: '1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.4)' }}>
               {isUploading ? <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }}/> : "지도에 업로드"}
             </button>
          </form>
        </div>

        {/* Tab 3: 피드 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'list' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '32px' }}>ACTIVITY FEED</h2>
           {reports.length === 0 ? <div style={{ textAlign: 'center', padding: '100px 0', color: '#94a3b8', fontWeight: '900' }}>기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} style={{ backgroundColor: 'white', padding: '24px', borderRadius: '36px', marginBottom: '20px', border: '1px solid #d1fae5', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                   <span style={{ fontSize: '0.875rem', fontWeight: '900', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span>
                   <button onClick={() => updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' })} style={{ border: 'none', padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: '900', backgroundColor: r.status === 'solved' ? '#10b981' : '#f8fafc', color: r.status === 'solved' ? 'white' : '#94a3b8', cursor: 'pointer' }}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                <p style={{ fontSize: '1rem', color: '#475569', lineHeight: '1.6', fontWeight: '600', padding: '0 4px', marginBottom: '20px' }}>{r.description}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '6px' }}><User size={14}/> {r.userName}</span>
                  {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} style={{ padding: '6px', backgroundColor: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}><Trash2 size={20}/></button>}
                </div>
             </div>
           ))}
        </div>

        {/* Tab 4: 통계 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'stats' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '32px' }}>ACTIVITY STATS</h2>
           <div style={{ backgroundColor: '#1e293b', padding: '48px 24px', borderRadius: '50px', textAlign: 'center', marginBottom: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
              <h3 style={{ fontSize: '4rem', fontWeight: '900', color: 'white', margin: '0 0 8px 0' }}>{reports.length}</h3>
              <p style={{ fontSize: '0.75rem', fontWeight: '900', color: '#10b981', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Total Trash Found</p>
           </div>
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '48px' }}>
              <div style={{ backgroundColor: 'white', padding: '32px 20px', borderRadius: '40px', textAlign: 'center', border: '1px solid #f0fdf4', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.04)' }}><p style={{ fontSize: '11px', fontWeight: '900', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase' }}>Success</p><p style={{ fontSize: '2rem', fontWeight: '900', color: '#10b981', margin: 0 }}>{solvedCount}</p></div>
              <div style={{ backgroundColor: 'white', padding: '32px 20px', borderRadius: '40px', textAlign: 'center', border: '1px solid #f0fdf4', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.04)' }}><p style={{ fontSize: '11px', fontWeight: '900', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase' }}>Pending</p><p style={{ fontSize: '2rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>{reports.length - solvedCount}</p></div>
           </div>
           
           {isAdmin && (
             <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '50px', border: '2px dashed #fee2e2', textAlign: 'center' }}>
               <h4 style={{ color: '#ef4444', fontWeight: '900', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '1.125rem' }}><AlertTriangle size={24}/> ADMIN ONLY</h4>
               <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '32px', fontWeight: '900' }}>전체 활동 기록을 영구히 초기화할 수 있습니다.</p>
               <button onClick={clearAllData} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '20px', borderRadius: '24px', fontWeight: '900', fontSize: '1.125rem', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(239, 68, 68, 0.4)' }}>모든 데이터 초기화</button>
             </div>
           )}
        </div>
      </main>

      {/* 하단 내비게이션 바 */}
      <nav style={{ height: '85px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '0 16px 24px', flexShrink: 0, boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.03)' }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', color: activeTab === 'map' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span style={{ fontSize: '11px', fontWeight: '900' }}>지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', color: activeTab === 'list' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <List size={26} strokeWidth={3}/>
          <span style={{ fontSize: '11px', fontWeight: '900' }}>피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', color: activeTab === 'stats' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <BarChart3 size={26} strokeWidth={3}/>
          <span style={{ fontSize: '11px', fontWeight: '900' }}>통계</span>
        </button>
      </nav>
      
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; border: none !important; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

// 렌더링 코드
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}