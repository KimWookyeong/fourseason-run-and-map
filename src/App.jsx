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
 * [사계절 런앤맵 - 완전 복구 및 오류 방어 최종본]
 * 1. 탭 복구: 하단 내비게이션 [지도, 피드, 통계] 3개 버튼 확실히 고정
 * 2. 저장 오류 해결: handleSave 실행 시 강제 인증 체크 및 재로그인 로직 강화
 * 3. 경로 안정화: Rule 1 준수 및 앱 아이디 v9 업데이트
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

// 고유 앱 아이디 (최종 수정을 위해 v9 사용)
const appId = 'fourseason-run-and-map-v9'; 
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
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // 1. 인증 초기화 (Rule 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
      } catch (e) { console.error("초기 인증 실패:", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신 (Rule 1 & 3)
  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime).getTime() - new Date(a.discoveredTime).getTime());
      setReports(formatted);
      updateMarkers(formatted);
    }, (error) => {
      console.error("데이터 수신 에러:", error);
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

  // 4. 지도 초기화 및 크기 보정
  useEffect(() => {
    if (isScriptLoaded && !isSettingNickname && activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMap.current) {
        setTimeout(() => {
          if (!mapContainerRef.current) return;
          leafletMap.current = window.L.map(mapContainerRef.current, { 
            zoomControl: false, attributionControl: false 
          }).setView(GEUMJEONG_CENTER, 14);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
          updateMarkers(reports);
          setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 400);
        }, 500);
      } else {
        setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 300);
      }
    }
  }, [isScriptLoaded, activeTab, isSettingNickname, nickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const pinColor = isAdmin ? '#ef4444' : (report.userName === nickname ? '#fbbf24' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  // 🚀 저장 실패 완전 방어 handleSave
  const handleSave = async (e) => {
    e.preventDefault();
    
    // 1. 즉시 실시간 인증 정보 확인 (Rule 3 강화)
    let currentAuthUser = auth.currentUser;
    if (!currentAuthUser) {
      try {
        const cred = await signInAnonymously(auth);
        currentAuthUser = cred.user;
      } catch (err) {
        return alert("네트워크가 불안정하여 기기 인증에 실패했습니다. 다시 시도해 주세요.");
      }
    }

    setIsUploading(true);
    try {
      // 2. 위치 결정 (GPS 좌표 우선, 없으면 지도 중심)
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      
      const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(reportsCollection, { 
        ...formData, 
        location: loc, 
        userName: nickname, 
        discoveredTime: new Date().toISOString() 
      });
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("성공적으로 저장되었습니다! 🏁");
    } catch (err) {
      console.error("저장 에러:", err);
      alert("데이터 저장에 실패했습니다. (원인: " + (err.message || "권한 오류") + ")");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
      alert("삭제되었습니다.");
    } catch (e) { alert("삭제 실패"); }
  };

  const clearAllData = async () => {
    if (!isAdmin) return;
    if (window.confirm("🚨 관리자 경고: 모든 활동 기록이 영구 삭제됩니다. 계속하시겠습니까?")) {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snapshot = await getDocs(coll);
        const batch = writeBatch(db);
        snapshot.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        alert("모든 데이터가 초기화되었습니다.");
      } catch (err) { alert("초기화 실패"); }
    }
  };

  if (isSettingNickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 }}>
        <div style={{ backgroundColor: '#10b981', width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', transform: 'rotate(12deg)', boxShadow: '0 10px 25px rgba(16,185,129,0.2)' }}>
          <Navigation size={40} color="white" fill="white" />
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', margin: '0 0 4px 0', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
        <p style={{ fontSize: '0.75rem', fontWeight: '900', color: '#10b981', letterSpacing: '0.3em', marginBottom: '40px' }}>RUN & MAP GEUMJEONG</p>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', width: '100%', maxWidth: '340px', textAlign: 'center' }}>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="학번_이름" style={{ width: '100%', padding: '16px', borderRadius: '20px', backgroundColor: '#f0fdf4', border: 'none', textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '24px', outline: 'none' }} autoFocus />
            <button type="submit" style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '16px', fontSize: '1.1rem', cursor: 'pointer' }}>참여하기</button>
          </form>
        </div>
      </div>
    );
  }

  const solvedCount = reports.filter(r => r.status === 'solved').length;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: 'sans-serif' }}>
      <header style={{ height: '65px', backgroundColor: 'white', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ backgroundColor: isAdmin ? '#ef4444' : '#10b981', padding: '6px', borderRadius: '10px', color: 'white' }}>
            {isAdmin ? <ShieldCheck size={16}/> : <Navigation size={16}/>}
          </div>
          <span style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ backgroundColor: '#f0fdf4', color: '#047857', fontWeight: '900', fontSize: '10px', padding: '4px 12px', borderRadius: '20px' }}>{nickname}</span>
          <button onClick={() => { localStorage.removeItem('team_nickname'); setNickname(''); setIsSettingNickname(true); signOut(auth); }} style={{ border: 'none', background: '#f1f5f9', padding: '8px', borderRadius: '10px', color: '#64748b' }}><LogOut size={16}/></button>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Tab 1: 지도 */}
        <div style={{ position: 'absolute', inset: 0, visibility: activeTab === 'map' ? 'visible' : 'hidden' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          <button onClick={() => setActiveTab('add')} style={{ position: 'absolute', bottom: '24px', left: '16px', right: '16px', backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '18px', zIndex: 1001, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>기록하기 +</button>
        </div>

        {/* Tab 2: 추가 (오버레이) */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', transform: activeTab === 'add' ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.4s ease', padding: '24px', overflowY: 'auto', zIndex: 2000 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>NEW RECORD</h2>
            <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'white', padding: '10px', borderRadius: '14px' }}><X/></button>
          </div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <button type="button" onClick={() => { navigator.geolocation.getCurrentPosition(pos => setFormData(prev => ({ ...prev, customLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))); }} style={{ height: '100px', borderRadius: '24px', backgroundColor: '#1e293b', color: 'white', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                   <MapPin size={24} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span style={{ fontSize: '10px', fontWeight: '900' }}>{formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <div style={{ backgroundColor: 'white', height: '100px', borderRadius: '24px', border: '2px dashed #d1fae5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                   <Camera size={24} color="#10b981"/><span style={{ fontSize: '10px', fontWeight: '900', color: '#10b981' }}>사진 준비중</span>
                </div>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{ padding: '14px', borderRadius: '20px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', background: 'white', fontWeight: '800' }}>
                   <span>{c.icon}</span><span style={{ fontSize: '11px' }}>{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." style={{ padding: '18px', borderRadius: '20px', height: '100px', border: 'none', outline: 'none' }} />
             <button disabled={isUploading} style={{ backgroundColor: '#10b981', color: 'white', padding: '18px', borderRadius: '20px', border: 'none', fontWeight: '900', fontSize: '1.1rem' }}>
               {isUploading ? <Loader2 className="animate-spin" /> : "지도에 업로드"}
             </button>
          </form>
        </div>

        {/* Tab 3: 피드 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', visibility: activeTab === 'list' ? 'visible' : 'hidden', opacity: activeTab === 'list' ? 1 : 0, transition: 'opacity 0.3s', padding: '24px', overflowY: 'auto' }}>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '24px' }}>활동 피드</h2>
           {reports.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} style={{ background: 'white', padding: '20px', borderRadius: '32px', marginBottom: '16px', border: '1px solid #d1fae5' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                   <span style={{ fontWeight: '900', color: '#1e293b' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.userName}</span>
                   {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} style={{ border: 'none', background: 'none', color: '#fca5a5', cursor: 'pointer' }}><Trash2 size={16}/></button>}
                </div>
                <p style={{ margin: 0, fontSize: '14px', color: '#475569' }}>{r.description}</p>
             </div>
           ))}
        </div>

        {/* Tab 4: 통계 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', visibility: activeTab === 'stats' ? 'visible' : 'hidden', opacity: activeTab === 'stats' ? 1 : 0, transition: 'opacity 0.3s', padding: '24px', overflowY: 'auto' }}>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '32px' }}>팀 활동 통계</h2>
           <div style={{ backgroundColor: '#1e293b', borderRadius: '32px', padding: '30px', color: 'white', textAlign: 'center', marginBottom: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '3rem', fontWeight: '900', margin: '0' }}>{reports.length}</h3>
              <p style={{ fontSize: '0.8rem', fontWeight: '900', color: '#10b981', textTransform: 'uppercase', letterSpacing: '2px' }}>Total Found</p>
           </div>
           
           {isAdmin && (
             <div style={{ marginTop: '40px', padding: '24px', backgroundColor: 'white', borderRadius: '32px', border: '2px dashed #fee2e2', textAlign: 'center' }}>
               <h4 style={{ color: '#ef4444', fontWeight: '900', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                 <AlertTriangle size={18}/> 관리자 도구
               </h4>
               <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>데이터를 영구히 초기화할 수 있습니다.</p>
               <button onClick={clearAllData} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '14px', borderRadius: '16px', fontWeight: '900', cursor: 'pointer' }}>데이터 전체 초기화</button>
             </div>
           )}
        </div>
      </main>

      {/* 하단 내비게이션 바 (지도, 피드, 통계 확실히 복구) */}
      <nav style={{ height: '80px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: '10px', zIndex: 1000 }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', color: activeTab === 'map' ? '#10b981' : '#cbd5e1', textAlign: 'center', cursor: 'pointer' }}>
          <MapPin size={24} fill={activeTab === 'map' ? '#10b981' : 'none'}/><br/><span style={{fontSize:'10px', fontWeight:'900'}}>지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', color: activeTab === 'list' ? '#10b981' : '#cbd5e1', textAlign: 'center', cursor: 'pointer' }}>
          <List size={24}/><br/><span style={{fontSize:'10px', fontWeight:'900'}}>피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{ border: 'none', background: 'none', color: activeTab === 'stats' ? '#10b981' : '#cbd5e1', textAlign: 'center', cursor: 'pointer' }}>
          <BarChart3 size={24}/><br/><span style={{fontSize:'10px', fontWeight:'900'}}>통계</span>
        </button>
      </nav>
      
      <style>{`
        .leaflet-container { background: #f0fdf4 !important; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

// 렌더링 코드
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);