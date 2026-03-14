import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, set, remove } from 'firebase/database';
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
  Image as ImageIcon,
  ChevronRight,
  Heart,
  Trash2,
  Award,
  CheckCircle2
} from 'lucide-react';

/**
 * [사계절 런앤맵 프로젝트 - 아카이브 풀스크린 및 통계 보강본]
 * - 모든 탭(아카이브, 통계, 기록)을 풀스크린 레이아웃으로 변경
 * - 통계 탭에 실시간 데이터 요약 및 지도 복귀(X) 버튼 추가
 * - 아카이브(피드) 가독성 극대화
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
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  
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

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
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
      }, 200);
    }
  }, [isScriptLoaded, activeTab]);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubscribeAuth = onAuthStateChanged(auth, setUser);

    const reportsRef = ref(db, 'reports');
    const unsubscribeData = onValue(reportsRef, (snapshot) => {
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

    return () => {
      unsubscribeAuth();
      unsubscribeData();
    };
  }, [nickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    data.forEach(report => {
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const isMine = report.userName === nickname;
      
      const iconHtml = `
        <div style="background-color:${cat.color}; width:36px; height:36px; border-radius:12px; border:3px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 15px rgba(0,0,0,0.2); transform:rotate(45deg);">
          <div style="transform:rotate(-45deg)">${cat.icon}</div>
        </div>
      `;
      
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [36, 36], iconAnchor: [18, 18] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      
      marker.bindPopup(`
        <div style="font-family:sans-serif; min-width:160px; padding:5px;">
          <b style="color:${cat.color}; font-size:16px;">${cat.icon} ${cat.label}</b><br/>
          <div style="margin-top:8px; font-size:12px; color:#4a5568;">
            <b>작성자:</b> ${report.userName} ${isMine ? '(나)' : ''}<br/>
            <b>위치:</b> ${report.area}
          </div>
          <p style="font-size:11px; color:#718096; margin-top:8px; border-top:1px solid #edf2f7; padding-top:5px;">
            ${report.description || '내용 없음'}
          </p>
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
    if (!nickname) return;
    const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
    const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
    
    await push(ref(db, 'reports'), { 
      ...formData, 
      location: loc, 
      userName: nickname, 
      discoveredTime: new Date().toISOString() 
    });
    
    setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
    setActiveTab('map');
  };

  const handleDelete = (id) => {
    remove(ref(db, `reports/${id}`));
    setShowDeleteModal(null);
  };

  if (isSettingNickname) {
    return (
      <div style={styles.mainContainer}>
        <div style={styles.logoSection}>
          <h1 style={styles.titleText}>FOUR SEASONS</h1>
          <div style={styles.subTitleText}>RUN & MAP GEUMJEONG</div>
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>반가워요 활동가님!</h2>
          <p style={styles.cardSub}>함께 지도를 완성하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form style={styles.form} onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input 
              type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="예: 금정_철수" 
              style={styles.inputField} autoFocus 
            />
            <button style={styles.submitButton}>지도 합류하기 <ChevronRight size={24}/></button>
          </form>
        </div>
      </div>
    );
  }

  // 통계 계산 로직
  const totalReports = reports.length;
  const solvedReports = reports.filter(r => r.status === 'solved').length;
  const solvedRate = totalReports > 0 ? Math.round((solvedReports / totalReports) * 100) : 0;

  return (
    <div style={styles.appRoot}>
      <header style={styles.header}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <div style={styles.headerIcon}><Navigation size={18} fill="currentColor"/></div>
          <h1 style={styles.headerTitle}>Four Seasons</h1>
        </div>
        <div style={styles.headerUser}>{nickname} 활동가</div>
      </header>

      <main style={styles.mainContent}>
        {/* 탭 1: 지도 (홈 화면) */}
        <div style={{...styles.tabView, opacity: activeTab === 'map' ? 1 : 0, zIndex: activeTab === 'map' ? 10 : 0}}>
          <div ref={mapContainerRef} style={{width: '100%', height: '100%'}} />
          <div style={styles.floatingPanel}>
            <div style={styles.statsRow}>
               <div style={{display: 'flex', gap: '20px', paddingLeft: '10px'}}>
                 <div style={{textAlign: 'center'}}><p style={styles.statLabel}>Total</p><p style={styles.statValue}>{reports.length}</p></div>
                 <div style={styles.statDivider}><p style={styles.statLabel}>Solved</p><p style={{...styles.statValue, color: '#10b981'}}>{reports.filter(r => r.status === 'solved').length}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} style={styles.recordButton}>
                 <PlusCircle size={20}/> 기록하기
               </button>
            </div>
          </div>
        </div>

        {/* 탭 2: 기록 추가 (풀스크린) */}
        <div style={{...styles.tabView, backgroundColor: '#f0fdf4', padding: '24px', overflowY: 'auto', transform: activeTab === 'add' ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.4s ease', zIndex: 50}}>
          <div style={{maxWidth: '400px', margin: '0 auto'}}>
            <div style={styles.formHeader}>
              <h2 style={styles.formTitle}>New Record</h2>
              <button onClick={() => setActiveTab('map')} style={styles.closeButton}><X/></button>
            </div>
            <form onSubmit={handleSave} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
              <div style={styles.reportRow}>
                <div style={styles.gpsCard}>
                  <span style={styles.gpsLabel}><MapPin size={14}/> GPS 위치</span>
                  <button type="button" onClick={getGPS} style={{...styles.gpsBtn, backgroundColor: formData.customLocation ? '#10b981' : 'white', color: formData.customLocation ? 'white' : '#1a202c'}}>
                    {isLocating ? "수신 중..." : formData.customLocation ? "위치 획득 완료" : "내 위치 잡기"}
                  </button>
                </div>
                <div style={styles.photoBox}>
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{display: 'none'}} id="photo-upload" />
                  <label htmlFor="photo-upload" style={{...styles.photoLabel, borderColor: formData.image ? '#10b981' : '#a7f3d0'}}>
                    {formData.image ? <img src={formData.image} style={styles.previewImg} /> : (
                      <div style={{textAlign: 'center'}}>
                        <Camera size={24} color="#10b981" style={{marginBottom: '4px'}}/>
                        <div style={{fontSize: '10px', color: '#059669', fontWeight: '900'}}>사진 추가</div>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div style={styles.categoryGrid}>
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{...styles.catBtn, borderColor: formData.category === c.id ? '#10b981' : 'transparent', backgroundColor: formData.category === c.id ? 'white' : 'rgba(255,255,255,0.4)'}}>
                    <span style={{fontSize: '22px'}}>{c.icon}</span>
                    <span style={{fontSize: '11px', fontWeight: '900', color: formData.category === c.id ? '#065f46' : '#94a3b8'}}>{c.label}</span>
                  </button>
                ))}
              </div>

              <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} style={styles.selectInput}>
                {GEUMJEONG_AREAS.map(a => <option key={a}>{a}</option>)}
              </select>

              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요? (예: 일회용 컵 5개 방치됨)" style={styles.textArea} />
              
              <button style={styles.saveButton}>지도로 공유하기</button>
            </form>
          </div>
        </div>

        {/* 탭 3: 팀 아카이브 (풀스크린) */}
        <div style={{...styles.tabView, backgroundColor: '#f0fdf4', padding: '24px', overflowY: 'auto', transform: activeTab === 'list' ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.4s ease', zIndex: 20}}>
          <div style={{maxWidth: '400px', margin: '0 auto'}}>
            <div style={styles.formHeader}>
              <h2 style={styles.formTitle}>Team Archive</h2>
              <button onClick={() => setActiveTab('map')} style={styles.closeButton}><X/></button>
            </div>
            <p style={{fontSize: '12px', color: '#94a3b8', marginBottom: '24px', fontWeight: 'bold'}}>우리 팀의 활동 현황을 큰 화면으로 확인하세요.</p>
            {reports.length === 0 ? (
              <div style={{textAlign: 'center', padding: '80px 0', color: '#cbd5e1', fontWeight: '900'}}>아직 등록된 기록이 없습니다.</div>
            ) : reports.map(r => (
              <div key={r.id} style={styles.feedCard}>
                <div style={styles.feedHeader}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                    <span style={styles.feedIconBox}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div>
                      <h4 style={{fontSize: '15px', fontWeight: '900', margin: 0}}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4>
                      <p style={{fontSize: '10px', color: '#94a3b8', margin: 0}}>{new Date(r.discoveredTime).toLocaleString()}</p>
                    </div>
                  </div>
                  <button onClick={() => set(ref(db, `reports/${r.id}/status`), r.status === 'pending' ? 'solved' : 'pending')} style={{...styles.solvedBtn, backgroundColor: r.status === 'solved' ? '#10b981' : '#f1f5f9', color: r.status === 'solved' ? 'white' : '#94a3b8'}}>
                    {r.status === 'solved' ? '해결 완료' : '진행중'}
                  </button>
                </div>
                {r.image && <img src={r.image} style={styles.feedImg} alt="현장 사진" />}
                <p style={styles.feedDesc}>{r.description || "상세 설명이 없습니다."}</p>
                <div style={styles.feedFooter}>
                  <span style={{color: r.userName === nickname ? '#10b981' : '#4b5563', fontSize: '12px'}}>👤 {r.userName} {r.userName === nickname ? '(나)' : ''}</span>
                  <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <span style={styles.feedAreaBadge}>{r.area}</span>
                    {r.userName === nickname && (
                      <button 
                        onClick={() => setShowDeleteModal(r.id)} 
                        style={{border: 'none', background: 'none', color: '#ef4444', padding: '5px', cursor: 'pointer'}}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 탭 4: 통계 (풀스크린 & 복귀 버튼 추가) */}
        <div style={{...styles.tabView, backgroundColor: '#f0fdf4', padding: '24px', overflowY: 'auto', transform: activeTab === 'stats' ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.4s ease', zIndex: 30}}>
           <div style={{maxWidth: '400px', margin: '0 auto'}}>
            <div style={styles.formHeader}>
              <h2 style={styles.formTitle}>Team Stats</h2>
              <button onClick={() => setActiveTab('map')} style={styles.closeButton}><X/></button>
            </div>
            
            <div style={styles.statsMainCard}>
               <Award size={48} color="#10b981" style={{marginBottom: '16px'}}/>
               <p style={{fontSize: '14px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px'}}>금정구 환경 수호 프로젝트</p>
               <h3 style={{fontSize: '32px', fontWeight: '900', color: '#1f2937', marginBottom: '24px'}}>성공률 {solvedRate}%</h3>
               
               <div style={styles.statsGrid}>
                  <div style={styles.statBox}>
                    <span style={styles.statBoxLabel}>발견됨</span>
                    <span style={styles.statBoxValue}>{totalReports}건</span>
                  </div>
                  <div style={styles.statBox}>
                    <span style={styles.statBoxLabel}>해결됨</span>
                    <span style={{...styles.statBoxValue, color: '#10b981'}}>{solvedReports}건</span>
                  </div>
               </div>
            </div>

            <div style={{marginTop: '32px'}}>
               <h4 style={{fontSize: '16px', fontWeight: '900', color: '#1f2937', marginBottom: '16px'}}>카테고리별 현황</h4>
               <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                  {TRASH_CATEGORIES.map(cat => {
                    const count = reports.filter(r => r.category === cat.id).length;
                    const percent = totalReports > 0 ? (count / totalReports) * 100 : 0;
                    return (
                      <div key={cat.id} style={styles.progressRow}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '6px'}}>
                          <span style={{fontSize: '13px', fontWeight: 'bold'}}>{cat.icon} {cat.label}</span>
                          <span style={{fontSize: '12px', fontWeight: '900', color: '#64748b'}}>{count}건</span>
                        </div>
                        <div style={styles.progressBarBg}>
                           <div style={{...styles.progressBarFill, width: `${percent}%`, backgroundColor: cat.color}}></div>
                        </div>
                      </div>
                    )
                  })}
               </div>
            </div>
            
            <button onClick={() => setActiveTab('map')} style={styles.statsReturnBtn}>
               <MapPin size={18}/> 지도로 돌아가기
            </button>
           </div>
        </div>
      </main>

      {/* 삭제 확인 모달 */}
      {showDeleteModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <AlertTriangle size={40} color="#ef4444" style={{marginBottom: '16px'}}/>
            <p style={{fontWeight: '900', fontSize: '18px', marginBottom: '10px'}}>기록 삭제</p>
            <p style={{fontSize: '14px', color: '#64748b', marginBottom: '24px'}}>이 소중한 기록을 정말 지울까요?</p>
            <div style={{display: 'flex', gap: '10px', width: '100%'}}>
              <button onClick={() => setShowDeleteModal(null)} style={{...styles.modalBtn, backgroundColor: '#f1f5f9', color: '#64748b'}}>취소</button>
              <button onClick={() => handleDelete(showDeleteModal)} style={{...styles.modalBtn, backgroundColor: '#ef4444', color: 'white'}}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* 하단 내비게이션 바 */}
      <nav style={styles.navbar}>
        <button onClick={() => setActiveTab('map')} style={{...styles.navBtn, color: activeTab === 'map' ? '#10b981' : '#cbd5e1'}}>
          <MapPin size={26} fill={activeTab === 'map' ? '#10b981' : 'none'}/>
          <span style={{fontSize: '10px', fontWeight: '900', marginTop: '4px'}}>지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{...styles.navBtn, color: activeTab === 'list' ? '#10b981' : '#cbd5e1'}}>
          <List size={26}/>
          <span style={{fontSize: '10px', fontWeight: '900', marginTop: '4px'}}>아카이브</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{...styles.navBtn, color: activeTab === 'stats' ? '#10b981' : '#cbd5e1'}}>
          <BarChart3 size={26}/>
          <span style={{fontSize: '10px', fontWeight: '900', marginTop: '4px'}}>통계</span>
        </button>
      </nav>

      <style>{`
        .leaflet-container { font-family: inherit; z-index: 1 !important; background: #f0fdf4; }
        .leaflet-popup-content-wrapper { border-radius: 20px; padding: 5px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
        .custom-pin { background: none; border: none; }
        ::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
    </div>
  );
}

const styles = {
  mainContainer: {
    height: '100vh', width: '100vw', backgroundColor: '#f0fdf4',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    paddingTop: '10vh', padding: '24px', fontFamily: 'sans-serif'
  },
  logoSection: { textAlign: 'center', marginBottom: '50px' },
  titleText: { fontSize: '42px', fontWeight: '900', color: '#2d3748', letterSpacing: '-0.05em', margin: 0 },
  subTitleText: { color: '#10b981', fontWeight: '900', fontSize: '12px', letterSpacing: '0.4em', marginTop: '10px' },
  card: {
    backgroundColor: 'white', borderRadius: '50px', padding: '40px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.06)', width: '100%', maxWidth: '360px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
  },
  cardHeading: { fontSize: '24px', fontWeight: '900', color: '#2d3748', marginBottom: '12px' },
  cardSub: { color: '#94a3b8', fontSize: '14px', fontWeight: '500', marginBottom: '35px', lineHeight: '1.5' },
  form: { width: '100%' },
  inputField: {
    width: '100%', padding: '20px', borderRadius: '25px', backgroundColor: '#ecfdf5',
    border: 'none', outline: 'none', fontWeight: 'bold', textAlign: 'center', fontSize: '18px',
    color: '#065f46', marginBottom: '25px'
  },
  submitButton: {
    width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none',
    fontWeight: '900', padding: '20px', borderRadius: '25px', fontSize: '18px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
  },
  appRoot: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'sans-serif', backgroundColor: '#f0fdf4' },
  header: { backgroundColor: 'rgba(255,255,255,0.9)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #d1fae5', zIndex: 1000 },
  headerIcon: { backgroundColor: '#10b981', padding: '6px', borderRadius: '10px', color: 'white' },
  headerTitle: { fontSize: '14px', fontWeight: '900', color: '#1f2937', margin: 0 },
  headerUser: { fontSize: '11px', fontWeight: 'bold', color: '#059669', backgroundColor: '#d1fae5', padding: '5px 12px', borderRadius: '20px' },
  mainContent: { flex: 1, position: 'relative' },
  tabView: { position: 'absolute', inset: 0, transition: 'all 0.4s ease-out' },
  floatingPanel: { position: 'absolute', bottom: '110px', left: '16px', right: '16px', zIndex: 1001 },
  statsRow: { backgroundColor: 'white', padding: '15px', borderRadius: '30px', boxShadow: '0 15px 35px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: '8px', fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' },
  statValue: { fontSize: '20px', fontWeight: '900', color: '#1f2937', margin: 0 },
  statDivider: { borderLeft: '1px solid #f1f5f9', paddingLeft: '20px' },
  recordButton: { backgroundColor: '#1a202c', color: 'white', padding: '14px 20px', borderRadius: '22px', border: 'none', fontWeight: '900', fontSize: '13px', display: 'flex', gap: '6px', alignItems: 'center' },
  formHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' },
  formTitle: { fontSize: '22px', fontWeight: '900', color: '#1f2937', textTransform: 'uppercase', margin: 0 },
  closeButton: { padding: '10px', backgroundColor: 'white', borderRadius: '14px', border: 'none', color: '#94a3b8' },
  reportRow: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px' },
  gpsCard: { backgroundColor: '#1a202c', padding: '20px', borderRadius: '28px', color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '130px' },
  gpsLabel: { fontSize: '10px', fontWeight: '900', color: '#10b981' },
  gpsBtn: { padding: '10px', borderRadius: '15px', border: 'none', fontWeight: '900', fontSize: '11px' },
  photoBox: { position: 'relative' },
  photoLabel: { border: '2px dashed', borderRadius: '28px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', cursor: 'pointer' },
  previewImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '26px' },
  categoryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  catBtn: { padding: '12px', border: '2px solid', borderRadius: '22px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  selectInput: { width: '100%', padding: '16px', borderRadius: '20px', border: 'none', backgroundColor: 'white', fontSize: '13px', fontWeight: 'bold', color: '#1f2937' },
  textArea: { width: '100%', padding: '20px', borderRadius: '28px', height: '120px', border: 'none', backgroundColor: 'white', fontSize: '14px', outline: 'none', resize: 'none' },
  saveButton: { width: '100%', padding: '20px', backgroundColor: '#10b981', color: 'white', borderRadius: '25px', border: 'none', fontWeight: '900', fontSize: '18px' },
  feedCard: { backgroundColor: 'white', padding: '24px', borderRadius: '40px', marginBottom: '24px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' },
  feedHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  feedIconBox: { fontSize: '28px', padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '16px' },
  solvedBtn: { padding: '8px 16px', borderRadius: '16px', border: 'none', fontSize: '11px', fontWeight: '900' },
  feedImg: { width: '100%', height: '220px', objectFit: 'cover', borderRadius: '32px', marginBottom: '16px' },
  feedDesc: { fontSize: '14px', fontWeight: '500', color: '#4b5563', padding: '20px', backgroundColor: '#f0fdf4', borderRadius: '28px', borderLeft: '5px solid #10b981', lineHeight: '1.6' },
  feedFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f0fdf4', fontWeight: 'bold' },
  feedAreaBadge: { backgroundColor: 'white', color: '#10b981', padding: '5px 12px', borderRadius: '15px', border: '1px solid #d1fae5', fontSize: '11px' },
  navbar: { backgroundColor: 'rgba(255,255,255,0.95)', padding: '15px 20px 30px 20px', display: 'flex', justifyContent: 'space-around', borderTop: '1px solid #d1fae5', zIndex: 2000 },
  navBtn: { border: 'none', backgroundColor: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' },
  modalContent: { backgroundColor: 'white', padding: '35px', borderRadius: '40px', width: '100%', maxWidth: '320px', textAlign: 'center' },
  modalBtn: { flex: 1, padding: '15px', borderRadius: '20px', border: 'none', fontWeight: '900', cursor: 'pointer' },
  
  // 통계 전용 스타일
  statsMainCard: { backgroundColor: 'white', borderRadius: '40px', padding: '40px 20px', textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.03)' },
  statsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  statBox: { backgroundColor: '#f8fafc', padding: '20px', borderRadius: '25px', display: 'flex', flexDirection: 'column', gap: '4px' },
  statBoxLabel: { fontSize: '11px', fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
  statBoxValue: { fontSize: '22px', fontWeight: '900', color: '#1f2937' },
  progressRow: { backgroundColor: 'white', padding: '16px', borderRadius: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' },
  progressBarBg: { height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: '4px', transition: 'width 1s ease-in-out' },
  statsReturnBtn: { width: '100%', marginTop: '32px', marginBottom: '80px', padding: '20px', backgroundColor: '#1a202c', color: 'white', borderRadius: '25px', border: 'none', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }
};