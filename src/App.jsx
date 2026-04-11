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
  List, 
  X, 
  User, 
  AlertTriangle, 
  Camera, 
  ChevronRight, 
  Trash2, 
  LogOut, 
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Image as ImageIcon
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 최종 긴급 복구 및 기능 안정화 통합 버전]
 * 1. 디자인: 요청하신 정교한 네잎클로버 SVG 및 연녹색 테마 (#f0fdf4)
 * 2. 지도 로딩: 입장 즉시 지도가 꽉 차도록 다중 보정 로직 적용 (invalidateSize)
 * 3. 사진 기능: 카메라 직접 촬영 및 갤러리 선택 저장 기능 (이미지 압축 포함)
 * 4. 데이터 오류: 모든 DB 작업 전 실시간 강제 인증 로직 (Rule 3 준수)
 * 5. 상태 변경: 피드에서 '진행중' 클릭 시 '완료됨'으로 즉시 변경 로직 정상화
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

// 고유 앱 아이디 (데이터 엉킴 방지 및 안정적인 통신을 위해 v400으로 갱신)
const appId = 'fourseason-run-and-map-v400-stable'; 
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

// [커스텀] 대칭이 완벽하고 예쁜 하트잎 네잎클로버 SVG
const PrettyClover = ({ size = 50, color = "#10b981" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.15))' }}>
    <g transform="translate(50, 50)">
      {[0, 90, 180, 270].map((angle) => (
        <path 
          key={angle}
          d="M0 0C-15 -25 -30 -15 -30 0C-30 15 -15 25 0 0ZM0 0C15 -25 30 -15 30 0C30 15 15 25 0 0Z" 
          fill={color} 
          transform={`rotate(${angle})`}
          stroke="#064e3b"
          strokeWidth="1.5"
        />
      ))}
    </g>
    <circle cx="50" cy="50" r="7" fill="white" opacity="0.5" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [inputNickname, setInputNickname] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // [핵심] 이미지 압축 로직 (DB 용량 초과 방지)
  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        }
      };
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (typeof event.target?.result === 'string') {
        const compressed = await compressImage(event.target.result);
        setFormData(prev => ({ ...prev, image: compressed }));
      }
    };
    reader.readAsDataURL(file);
  };

  // [핵심] 인증 보장 함수 (Rule 3)
  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      const res = await signInAnonymously(auth);
      setUser(res.user);
      return res.user;
    } catch (err) {
      console.error("인증 재시도 실패:", err);
      return null;
    }
  };

  // 1. 초기 실행 및 인증
  useEffect(() => {
    const init = async () => {
      await ensureAuth();
      setIsAppReady(true);
    };
    init();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신 (Rule 1)
  useEffect(() => {
    if (!user || !nickname) return;
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    }, (err) => console.error("Firestore 수신 에러:", err));
    return () => unsubscribe();
  }, [user, nickname]);

  // 3. 지도 라이브러리 동적 로드
  useEffect(() => {
    if (typeof window.L !== 'undefined') {
      setIsScriptLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // 4. 지도 초기화 및 크기 보정 로직
  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      const initTimer = setTimeout(() => {
        if (!mapContainerRef.current) return;
        if (!leafletMap.current) {
          leafletMap.current = window.L.map(mapContainerRef.current, { 
            zoomControl: false, attributionControl: false 
          }).setView(GEUMJEONG_CENTER, 14);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        }
        updateMarkers(reports);
        // 화면 레이아웃 안정화 후 3차례 보정
        [100, 500, 1000].forEach(delay => {
          setTimeout(() => { if(leafletMap.current) leafletMap.current.invalidateSize(); }, delay);
        });
      }, 300);
      return () => clearTimeout(initTimer);
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
      const iconHtml = `<div style="background-color:${cat.color}; width:34px; height:34px; border-radius:12px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:20px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.2);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;
    try {
      await ensureAuth();
      localStorage.setItem('team_nickname', inputNickname);
      setNickname(inputNickname);
    } catch (err) {
      alert("입장에 실패했습니다. 새로고침 후 다시 시도하세요.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      await ensureAuth(); // 저장 전 강제 인증
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      
      await addDoc(coll, { 
        ...formData, 
        location: loc, 
        userName: nickname, 
        discoveredTime: new Date().toISOString() 
      });
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("성공적으로 저장되었습니다! 🍀");
    } catch (err) { 
      alert("저장 실패: 다시 한 번 시도해 주세요."); 
    } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      await ensureAuth();
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
      alert("삭제되었습니다.");
    } catch (err) { alert("삭제 실패: 권한이 부족합니다."); }
  };

  const handleToggleStatus = async (reportId, currentStatus) => {
    try {
      await ensureAuth();
      const newStatus = currentStatus === 'pending' ? 'solved' : 'pending';
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId);
      await updateDoc(docRef, { status: newStatus });
      alert(newStatus === 'solved' ? "완료됨으로 변경되었습니다! ✨" : "진행중으로 변경되었습니다.");
    } catch (err) { alert("상태 변경 실패: 다시 시도해 주세요."); }
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

  // 초기 로딩 가드
  if (!isAppReady) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={40} color="#10b981" style={{ animation: 'spin 1s linear infinite' }} />
        <p style={{ marginTop: '16px', color: '#10b981', fontWeight: '900', fontSize: '1.1rem' }}>사계절 앱 연결 중...</p>
      </div>
    );
  }

  // 닉네임 입력 화면
  if (!nickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', zIndex: 9999, fontFamily: 'sans-serif' }}>
        <div style={{ marginBottom: '40px', textAlign: 'center', width: '100%' }}>
          <div style={{ margin: '0 auto 24px' }}>
            <PrettyClover size={150} />
          </div>
          <h1 style={{ fontSize: '3rem', fontWeight: '900', color: '#1e293b', marginBottom: '8px', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
          <p style={{ fontSize: '1rem', fontWeight: '800', color: '#10b981', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Run & Map Geumjeong</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '45px 30px', borderRadius: '50px', width: '100%', maxWidth: '420px', textAlign: 'center', boxShadow: '0 35px 70px -15px rgba(0, 0, 0, 0.15)', border: '1px solid #f0fdf4' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#1e293b', marginBottom: '10px' }}>활동가 합류</h2>
          <p style={{ fontSize: '1rem', color: '#64748b', marginBottom: '35px', lineHeight: '1.6' }}>우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={handleJoin} style={{ width: '100%' }}>
            <input 
              type="text" 
              value={inputNickname}
              onChange={(e) => setInputNickname(e.target.value)}
              placeholder="예시: 금정_이름" 
              style={{ width: '100%', padding: '22px', borderRadius: '25px', backgroundColor: '#f8fafc', border: '2px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold', fontSize: '1.4rem', marginBottom: '25px', outline: 'none', boxSizing: 'border-box' }} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '25px', padding: '24px', fontSize: '1.4rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 12px 20px -3px rgba(16, 185, 129, 0.4)' }}>지도 합류하기 <ChevronRight size={28}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* 헤더 */}
      <header style={{ height: '75px', backgroundColor: 'white', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 1000, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: isAdmin ? '#ef4444' : '#10b981', padding: '7px', borderRadius: '14px', color: 'white' }}>
            {isAdmin ? <ShieldCheck size={22}/> : <PrettyClover size={30} color="white" />}
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '13px', fontWeight: '900', backgroundColor: '#f0fdf4', color: '#047857', padding: '8px 16px', borderRadius: '20px', border: '1px solid #d1fae5' }}>{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")){ localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); } }} style={{ padding: '12px', backgroundColor: '#f8fafc', border: 'none', borderRadius: '16px', color: '#94a3b8', cursor: 'pointer' }}><LogOut size={22}/></button>
        </div>
      </header>

      {/* 메인 영역 */}
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Tab 1: 지도 */}
        <div style={{ position: 'absolute', inset: 0, visibility: activeTab === 'map' ? 'visible' : 'hidden', zIndex: 10 }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '100%', backgroundColor: '#f0fdf4' }} />
          <button onClick={() => setActiveTab('add')} style={{ position: 'absolute', bottom: '35px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '60px', padding: '22px 50px', fontSize: '1.3rem', zIndex: 1001, boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.3)', cursor: 'pointer' }}>기록하기 +</button>
        </div>

        {/* Tab 2: 추가 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'add' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>NEW RECORD</h2>
            <button onClick={() => setActiveTab('map')} style={{ padding: '14px', backgroundColor: 'white', border: 'none', borderRadius: '20px', boxShadow: '0 6px 12px -1px rgba(0,0,0,0.1)', cursor: 'pointer' }}><X size={30}/></button>
          </div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <button type="button" onClick={getGPS} style={{ height: '130px', borderRadius: '40px', backgroundColor: '#1e293b', color: 'white', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer' }}>
                   <MapPin size={36} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span style={{ fontSize: '0.9rem', fontWeight: '900' }}>{isLocating ? "수신 중..." : formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <label style={{ height: '130px', borderRadius: '40px', backgroundColor: 'white', border: '2px dashed #d1fae5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: '#10b981', cursor: 'pointer', overflow: 'hidden' }}>
                   <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} style={{ display: 'none' }} />
                   {formData.image ? <img src={formData.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><Camera size={36}/><span style={{ fontSize: '0.9rem', fontWeight: '900' }}>카메라/갤러리</span></>}
                </label>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} style={{ padding: '22px', borderRadius: '25px', border: '2px solid #e2e8f0', fontWeight: 'bold', fontSize: '1.2rem', outline: 'none', backgroundColor: 'white' }}>
                {GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
             </select>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{ padding: '22px', borderRadius: '25px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', backgroundColor: 'white', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', boxShadow: formData.category === c.id ? 'inset 0 4px 8px rgba(0,0,0,0.08)' : '0 4px 8px rgba(0,0,0,0.02)' }}>
                   <span style={{ fontSize: '1.8rem' }}>{c.icon}</span><span style={{ fontSize: '1rem', fontWeight: '900', color: '#1e293b' }}>{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." style={{ padding: '28px', borderRadius: '40px', height: '160px', border: '2px solid #e2e8f0', outline: 'none', resize: 'none', fontSize: '1.1rem', boxSizing: 'border-box' }} />
             <button disabled={isUploading} style={{ backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '40px', padding: '28px', fontSize: '1.4rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', boxShadow: '0 15px 25px -3px rgba(16, 185, 129, 0.4)' }}>
               {isUploading ? <Loader2 size={30} style={{ animation: 'spin 1s linear infinite' }}/> : "지도에 업로드"}
             </button>
          </form>
        </div>

        {/* Tab 3: 피드 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'list' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
           <h2 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#1e293b', marginBottom: '35px' }}>ACTIVITY FEED</h2>
           {reports.length === 0 ? <div style={{ textAlign: 'center', padding: '120px 0', color: '#94a3b8', fontWeight: '900' }}>기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} style={{ backgroundColor: 'white', padding: '32px', borderRadius: '45px', marginBottom: '25px', border: '1px solid #d1fae5', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                   <span style={{ fontSize: '1.1rem', fontWeight: '900', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '12px' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span>
                   <button onClick={() => handleToggleStatus(r.id, r.status)} style={{ border: 'none', padding: '10px 22px', borderRadius: '30px', fontSize: '13px', fontWeight: '900', backgroundColor: r.status === 'solved' ? '#10b981' : '#f1f5f9', color: r.status === 'solved' ? 'white' : '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {r.status === 'solved' ? <CheckCircle2 size={14}/> : null} {r.status === 'solved' ? '완료됨 ✓' : '진행중'}
                   </button>
                </div>
                {r.image && <img src={r.image} style={{ width: '100%', height: '260px', objectFit: 'cover', borderRadius: '30px', marginBottom: '20px' }} />}
                <p style={{ fontSize: '1.2rem', color: '#475569', lineHeight: '1.7', fontWeight: '600', padding: '0 5px', marginBottom: '25px' }}>{r.description}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '25px', borderTop: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '10px' }}><User size={18}/> {r.userName}</span>
                  {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} style={{ padding: '10px', backgroundColor: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}><Trash2 size={24}/></button>}
                </div>
             </div>
           ))}
        </div>

        {/* Tab 4: 통계 */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'stats' ? 'block' : 'none', backgroundColor: '#f0fdf4', padding: '32px', overflowY: 'auto', zIndex: 20 }}>
           <h2 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#1e293b', marginBottom: '35px' }}>ACTIVITY STATS</h2>
           <div style={{ backgroundColor: '#1e293b', padding: '60px 30px', borderRadius: '60px', textAlign: 'center', marginBottom: '35px', boxShadow: '0 30px 40px -5px rgba(0, 0, 0, 0.15)' }}>
              <h3 style={{ fontSize: '5rem', fontWeight: '900', color: 'white', margin: '0 0 12px 0' }}>{reports.length}</h3>
              <p style={{ fontSize: '1rem', fontWeight: '900', color: '#10b981', letterSpacing: '0.3em', textTransform: 'uppercase' }}>Total Trash Found</p>
           </div>
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '60px' }}>
              <div style={{ backgroundColor: 'white', padding: '40px 25px', borderRadius: '50px', textAlign: 'center', border: '1px solid #f0fdf4', boxShadow: '0 15px 25px -3px rgba(0, 0, 0, 0.05)' }}><p style={{ fontSize: '13px', fontWeight: '900', color: '#94a3b8', marginBottom: '12px', textTransform: 'uppercase' }}>Solved</p><p style={{ fontSize: '2.5rem', fontWeight: '900', color: '#10b981', margin: 0 }}>{solvedCount}</p></div>
              <div style={{ backgroundColor: 'white', padding: '40px 25px', borderRadius: '50px', textAlign: 'center', border: '1px solid #f0fdf4', boxShadow: '0 15px 25px -3px rgba(0, 0, 0, 0.05)' }}><p style={{ fontSize: '13px', fontWeight: '900', color: '#94a3b8', marginBottom: '12px', textTransform: 'uppercase' }}>Remaining</p><p style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>{reports.length - solvedCount}</p></div>
           </div>
           
           {isAdmin && (
             <div style={{ backgroundColor: 'white', padding: '50px', borderRadius: '60px', border: '2px dashed #fee2e2', textAlign: 'center' }}>
               <h4 style={{ color: '#ef4444', fontWeight: '900', margin: '0 0 18px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', fontSize: '1.4rem' }}><AlertTriangle size={32}/> ADMIN ONLY</h4>
               <p style={{ fontSize: '15px', color: '#94a3b8', marginBottom: '40px', fontWeight: '900' }}>전체 활동 기록을 영구히 초기화할 수 있습니다.</p>
               <button onClick={clearAllData} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '24px', borderRadius: '32px', fontWeight: '900', fontSize: '1.3rem', cursor: 'pointer', boxShadow: '0 12px 20px -3px rgba(239, 68, 68, 0.4)' }}>모든 데이터 초기화</button>
             </div>
           )}
        </div>
      </main>

      {/* 하단 내비게이션 바 */}
      <nav style={{ height: '110px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '0 16px 40px', flexShrink: 0, boxShadow: '0 -15px 25px -3px rgba(0, 0, 0, 0.04)' }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', color: activeTab === 'map' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <MapPin size={32} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span style={{ fontSize: '13px', fontWeight: '900' }}>지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', color: activeTab === 'list' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <List size={32} strokeWidth={3}/>
          <span style={{ fontSize: '13px', fontWeight: '900' }}>피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', color: activeTab === 'stats' ? '#10b981' : '#cbd5e1', transition: 'all 0.2s' }}>
          <BarChart3 size={32} strokeWidth={3}/>
          <span style={{ fontSize: '13px', fontWeight: '900' }}>통계</span>
        </button>
      </nav>
      
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; border: none !important; width: 100% !important; height: 100% !important; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------
// [최종 실행 엔진] 이 코드가 앱을 실제 브라우저에 그립니다.
// ---------------------------------------------------------
const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}