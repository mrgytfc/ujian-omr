import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import './App.css'

const SUPABASE_URL = 'https://iyjcraipxoehifpqijug.supabase.co'
const SUPABASE_KEY = 'sb_publishable_QIz8ugW0CVo5-PR9ItcMoA_qlwHElUw'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(null)
  const [pesan, setPesan] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [students, setStudents] = useState([])
  const [exams, setExams] = useState([])
  const [results, setResults] = useState([])
  const [newStudent, setNewStudent] = useState({ nis: '', nama: '', kelas: '' })
  const [newExam, setNewExam] = useState({ mata_pelajaran: '', kunci_jawaban: '' })
  const [selectedExam, setSelectedExam] = useState('')
  const [selectedNis, setSelectedNis] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadData(session.user.id)
    })
  }, [])

  useEffect(() => {
    if (activeTab === 'scan' && user) {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [activeTab])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
      }
    } catch (err) {
      console.error('Kamera error:', err)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }

  const loadData = async (guruId) => {
    const { data: siswaData } = await supabase
      .from('guru_siswa')
      .select('nis_siswa, students(nama, kelas)')
      .eq('guru_id', guruId)
    setStudents(siswaData?.map(s => ({ nis: s.nis_siswa, ...s.students })) || [])

    const { data: ujianData } = await supabase
      .from('exams')
      .select('*')
      .eq('guru_id', guruId)
    setExams(ujianData || [])

    const { data: hasilData } = await supabase
      .from('hasil_scan')
      .select('*, students(nama), exams(mata_pelajaran)')
    setResults(hasilData || [])
  }

  const handleSignUp = async () => {
    setPesan('Mendaftar...')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setPesan('Gagal: ' + error.message)
    else {
      setPesan('Berhasil! Langsung login...')
      const { data } = await supabase.auth.signInWithPassword({ email, password })
      if (data?.user) {
        await supabase.from('teachers').upsert({ id: data.user.id, email, nama: email.split('@')[0] })
      }
    }
  }

  const handleLogin = async () => {
    setPesan('Login...')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setPesan('Gagal: ' + error.message)
    else {
      setUser(data.user)
      setPesan('')
      loadData(data.user.id)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setStudents([])
    setExams([])
    setResults([])
    setActiveTab('dashboard')
  }

  const addStudent = async () => {
    if (!newStudent.nis || !newStudent.nama) return alert('NIS dan Nama wajib diisi')
    await supabase.from('students').upsert(newStudent)
    await supabase.from('guru_siswa').insert({ guru_id: user.id, nis_siswa: newStudent.nis })
    setNewStudent({ nis: '', nama: '', kelas: '' })
    loadData(user.id)
    alert('Siswa berhasil ditambahkan!')
  }

  const addExam = async () => {
    if (!newExam.mata_pelajaran || !newExam.kunci_jawaban) return alert('Semua field wajib diisi')
    const kunci = newExam.kunci_jawaban.toUpperCase().replace(/[^ABCDE]/g, '').split('')
    if (kunci.length !== 30) return alert(`Kunci jawaban harus 30 karakter (saat ini: ${kunci.length})`)
    await supabase.from('exams').insert({
      guru_id: user.id,
      mata_pelajaran: newExam.mata_pelajaran,
      kunci_jawaban: JSON.stringify(kunci)
    })
    setNewExam({ mata_pelajaran: '', kunci_jawaban: '' })
    loadData(user.id)
    alert('Ujian berhasil dibuat!')
  }

  const captureAndScan = async () => {
    if (!selectedExam || !selectedNis) return alert('Pilih ujian dan siswa terlebih dahulu')
    if (!videoRef.current) return alert('Kamera tidak siap')

    setIsScanning(true)
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    try {
      const processedCanvas = preprocessImage(canvas)
      const jawaban = detectBubble(processedCanvas)
      const exam = exams.find(e => e.id === selectedExam)
      const skor = calculateScore(jawaban, JSON.parse(exam.kunci_jawaban))

      setScanResult({ jawaban, skor, total: 30 })

      await supabase.from('hasil_scan').insert({
        exam_id: selectedExam,
        nis_siswa: selectedNis,
        skor,
        jawaban_siswa: JSON.stringify(jawaban)
      })

      loadData(user.id)
      alert(`Scan berhasil! Skor: ${skor}/30`)
    } catch (err) {
      console.error('Scan error:', err)
      alert('Gagal memproses gambar. Pastikan cahaya terang dan kertas rata.')
    } finally {
      setIsScanning(false)
    }
  }

  const exportToExcel = () => {
    const exportData = results.map(r => ({
      'Mata Pelajaran': r.exams?.mata_pelajaran || '-',
      'NIS': r.nis_siswa,
      'Nama': r.students?.nama || '-',
      'Skor': r.skor,
      'Waktu Scan': new Date(r.waktu_scan).toLocaleString()
    }))
    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Hasil Ujian')
    XLSX.writeFile(wb, `Hasil_Ujian_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  function preprocessImage(sourceCanvas) {
    const ctx = sourceCanvas.getContext('2d')
    const w = sourceCanvas.width
    const h = sourceCanvas.height
    const id = ctx.getImageData(0, 0, w, h)
    const data = id.data

    const margin = 0.1
    const corners = []
    const regions = [
      { x: 0, y: 0, w: w * margin, h: h * margin },
      { x: w * (1 - margin), y: 0, w: w * margin, h: h * margin },
      { x: 0, y: h * (1 - margin), w: w * margin, h: h * margin },
      { x: w * (1 - margin), y: h * (1 - margin), w: w * margin, h: h * margin }
    ]

    regions.forEach(r => {
      let sumX = 0, sumY = 0, count = 0
      for (let y = r.y; y < r.y + r.h; y += 3) {
        for (let x = r.x; x < r.x + r.w; x += 3) {
          const i = (Math.floor(y) * w + Math.floor(x)) * 4
          if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) {
            sumX += x
            sumY += y
            count++
          }
        }
      }
      corners.push(count > 20 ? { x: sumX / count, y: sumY / count } : null)
    })

    if (corners.every(c => c)) {
      const sorted = corners.sort((a, b) => a.y - b.y)
      const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x)
      const bot = sorted.slice(2, 4).sort((a, b) => a.x - b.x)
      const pts = [top[0], top[1], bot[0], bot[1]]

      const newW = 800
      const newH = Math.round(newW * 1.414)
      const outCanvas = document.createElement('canvas')
      outCanvas.width = newW
      outCanvas.height = newH
      const outCtx = outCanvas.getContext('2d')

      const destW = pts[1].x - pts[0].x
      const destH = pts[2].y - pts[0].y

      outCtx.drawImage(
        sourceCanvas,
        pts[0].x, pts[0].y, destW, destH,
        0, 0, newW, newH
      )
      return outCanvas
    }
    return sourceCanvas
  }

  function detectBubble(canvas) {
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    const id = ctx.getImageData(0, 0, w, h)
    const data = id.data

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const val = gray < 140 ? 0 : 255
      data[i] = data[i + 1] = data[i + 2] = val
    }
    ctx.putImageData(id, 0, 0)

    const jawaban = []
    const rows = 30
    const cols = 5
    const cellW = w / cols
    const cellH = h / rows

    for (let r = 0; r < rows; r++) {
      let maxDark = 0
      let pick = null
      for (let c = 0; c < cols; c++) {
        const slice = ctx.getImageData(c * cellW, r * cellH, cellW, cellH).data
        let dark = 0
        for (let p = 0; p < slice.length; p += 4) {
          if (slice[p] < 50) dark++
        }
        if (dark > maxDark) {
          maxDark = dark
          pick = c
        }
      }
      jawaban.push(pick !== null ? String.fromCharCode(65 + pick) : '-')
    }
    return jawaban
  }

  function calculateScore(jawaban, kunci) {
    let benar = 0
    for (let i = 0; i < 30; i++) {
      if (jawaban[i] === kunci[i]) benar++
    }
    return benar
  }

  if (!user) {
    return (
      <div style={{ maxWidth: '400px', margin: '60px auto', padding: '24px', border: '1px solid #e5e7eb', borderRadius: '12px', fontFamily: 'Arial' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Login Guru</h2>
        <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '12px', boxSizing: 'border-box' }} />
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '12px', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleLogin} style={{ flex: 1, padding: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Masuk</button>
          <button onClick={handleSignUp} style={{ flex: 1, padding: '10px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Daftar Baru</button>
        </div>
        {pesan && <p style={{ marginTop: '12px', color: '#2563eb', textAlign: 'center' }}>{pesan}</p>}
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>🎓 Dashboard Guru</h2>
        <button onClick={handleLogout} style={{ background: '#ef4444', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: '4px' }}>Logout</button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {['dashboard', 'siswa', 'ujian', 'scan', 'hasil'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab ? '#3b82f6' : '#f3f4f6',
              color: activeTab === tab ? '#fff' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              textTransform: 'capitalize'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <div>
          <h3>📊 Ringkasan</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
            <div style={{ padding: '15px', background: '#dbeafe', borderRadius: '8px' }}>
              <h4>👥 Total Siswa</h4>
              <p style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{students.length}</p>
            </div>
            <div style={{ padding: '15px', background: '#fef3c7', borderRadius: '8px' }}>
              <h4>📝 Total Ujian</h4>
              <p style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{exams.length}</p>
            </div>
            <div style={{ padding: '15px', background: '#d1fae5', borderRadius: '8px' }}>
              <h4>✅ Total Scan</h4>
              <p style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{results.length}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'siswa' && (
        <div>
          <h3>👥 Tambah Siswa</h3>
          <input placeholder="NIS" value={newStudent.nis} onChange={e => setNewStudent({...newStudent, nis: e.target.value})} style={{ padding: '8px', marginRight: '10px' }} />
          <input placeholder="Nama" value={newStudent.nama} onChange={e => setNewStudent({...newStudent, nama: e.target.value})} style={{ padding: '8px', marginRight: '10px' }} />
          <input placeholder="Kelas" value={newStudent.kelas} onChange={e => setNewStudent({...newStudent, kelas: e.target.value})} style={{ padding: '8px', marginRight: '10px' }} />
          <button onClick={addStudent} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px' }}>Tambah</button>
          <h4 style={{ marginTop: '20px' }}>Daftar Siswa ({students.length})</h4>
          <ul>{students.map(s => <li key={s.nis}>{s.nis} - {s.nama} ({s.kelas})</li>)}</ul>
        </div>
      )}

      {activeTab === 'ujian' && (
        <div>
          <h3>📝 Buat Ujian Baru</h3>
          <input placeholder="Mata Pelajaran" value={newExam.mata_pelajaran} onChange={e => setNewExam({...newExam, mata_pelajaran: e.target.value})} style={{ padding: '8px', marginRight: '10px', width: '300px' }} />
          <br /><br />
          <input placeholder="Kunci Jawaban (30 huruf A-E)" value={newExam.kunci_jawaban} onChange={e => setNewExam({...newExam, kunci_jawaban: e.target.value})} style={{ padding: '8px', width: '100%', maxWidth: '500px' }} />
          <br /><br />
          <button onClick={addExam} style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px' }}>Buat Ujian</button>
          <h4 style={{ marginTop: '20px' }}>Daftar Ujian</h4>
          <ul>{exams.map(e => <li key={e.id}>{e.mata_pelajaran} - {new Date(e.tanggal).toLocaleDateString()}</li>)}</ul>
        </div>
      )}

      {activeTab === 'scan' && (
        <div>
          <h3>📷 Scan Lembar Jawaban</h3>
          <select value={selectedExam} onChange={e => setSelectedExam(e.target.value)} style={{ padding: '8px', width: '100%', marginBottom: '10px' }}>
            <option value="">Pilih Ujian...</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.mata_pelajaran}</option>)}
          </select>
          <select value={selectedNis} onChange={e => setSelectedNis(e.target.value)} style={{ padding: '8px', width: '100%', marginBottom: '10px' }}>
            <option value="">Pilih Siswa...</option>
            {students.map(s => <option key={s.nis} value={s.nis}>{s.nis} - {s.nama}</option>)}
          </select>
          
          <div style={{ position: 'relative', width: '100%', maxWidth: '500px', margin: '0 auto', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', display: 'block' }} />
            <div style={{
              position: 'absolute',
              top: '5%',
              left: '5%',
              width: '90%',
              height: '90%',
              border: '3px dashed #3b82f6',
              borderRadius: '8px',
              pointerEvents: 'none',
              boxSizing: 'border-box'
            }}></div>
            <p style={{ textAlign: 'center', color: '#fff', fontSize: '12px', margin: '10px 0', background: 'rgba(0,0,0,0.7)', padding: '5px' }}>
              Posisikan 4 kotak hitam di sudut dalam frame biru
            </p>
          </div>

          <button 
            onClick={captureAndScan} 
            disabled={!selectedExam || !selectedNis || isScanning} 
            style={{
              width: '100%',
              padding: '15px',
              background: isScanning ? '#9ca3af' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              marginTop: '15px',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: 'bold'
            }}
          >
            {isScanning ? '⏳ Memproses...' : '📸 Ambil & Scan'}
          </button>

          {scanResult && (
            <div style={{ marginTop: '20px', padding: '20px', background: '#d1fae5', borderRadius: '8px', border: '2px solid #10b981' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>✅ Hasil Scan</h4>
              <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '10px 0' }}>Skor: {scanResult.skor} / {scanResult.total}</p>
              <p style={{ fontSize: '12px', wordBreak: 'break-all' }}>Jawaban: {scanResult.jawaban.join(' ')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'hasil' && (
        <div>
          <h3>📊 Hasil Ujian</h3>
          <button onClick={exportToExcel} style={{ padding: '10px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', marginBottom: '15px', cursor: 'pointer' }}>
            📥 Export ke Excel
          </button>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={{ border: '1px solid #ddd', padding: '10px' }}>Mapel</th>
                  <th style={{ border: '1px solid #ddd', padding: '10px' }}>NIS</th>
                  <th style={{ border: '1px solid #ddd', padding: '10px' }}>Nama</th>
                  <th style={{ border: '1px solid #ddd', padding: '10px' }}>Skor</th>
                  <th style={{ border: '1px solid #ddd', padding: '10px' }}>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id}>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{r.exams?.mata_pelajaran}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{r.nis_siswa}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{r.students?.nama}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px', fontWeight: 'bold' }}>{r.skor}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{new Date(r.waktu_scan).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length === 0 && <p style={{ textAlign: 'center', color: '#999' }}>Belum ada hasil scan</p>}
          </div>
        </div>
      )}
    </div>
  )
}