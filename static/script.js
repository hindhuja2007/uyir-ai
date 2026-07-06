/* ---------------- Page navigation ---------------- */
function goPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ---------------- History (localStorage) ---------------- */
function saveHistory(type, summary){
  const hist = JSON.parse(localStorage.getItem('uyir_history')||'[]');
  hist.unshift({type, summary, time: new Date().toLocaleString()});
  localStorage.setItem('uyir_history', JSON.stringify(hist.slice(0,5)));
  renderHistory();
}
function renderHistory(){
  const hist = JSON.parse(localStorage.getItem('uyir_history')||'[]');
  const wrap = document.getElementById('recentWrap');
  const list = document.getElementById('recentList');
  if(!hist.length){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  list.innerHTML = hist.map(h=>`<div class="recent-item"><b>${h.type}</b> — ${h.summary} <span style="opacity:.6">(${h.time})</span></div>`).join('');
}
renderHistory();

/* ---------------- Quick symptom chips ---------------- */
const QUICK_LIST = ['fever','cold','cough','headache','sore throat','diarrhea','vomiting','stomach pain','acidity','gas','constipation','back pain','tooth pain','ear pain','allergy','anxiety','insomnia','period cramps','காய்ச்சல்','சளி','தலைவலி','வயிற்றுவலி'];
const quickWrap = document.getElementById('quickSymptoms');
QUICK_LIST.forEach(sym=>{
  const b = document.createElement('button');
  b.className='chip'; b.textContent=sym;
  b.onclick=()=>{ document.getElementById('symptomText').value=sym; handleSymptomInput(sym); };
  quickWrap.appendChild(b);
});

/* ---------------- Emergency keyword guard ---------------- */
const EMERGENCY_WORDS = ['chest pain','severe breathlessness',"can't breathe",'cannot breathe','fainting','fainted','unconscious','stroke','numbness one side','severe bleeding','மார்வலி','மூச்சுத்திணறல்','மயக்கம்'];
function isEmergency(text){ const t=text.toLowerCase(); return EMERGENCY_WORDS.some(w=>t.includes(w.toLowerCase())); }

/* ---------------- Speech synthesis / recognition ---------------- */
function speak(text){
  const outSel = document.getElementById('voiceOut')?.value;
  if(outSel === 'off') return;
  const lang = document.getElementById('lang')?.value || 'en-IN';
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}
document.getElementById('speakBtn').addEventListener('click', ()=> speak(document.getElementById('symptomOutput').innerText));

let recognizer, recognizing=false;
function startRecognition(){
  const lang = document.getElementById('lang').value || 'en-IN';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ alert('Speech Recognition not supported. Try Chrome.'); return; }
  if(recognizing) return;
  recognizer = new SR(); recognizer.lang = lang; recognizer.interimResults=false; recognizer.maxAlternatives=1;
  recognizer.onresult = (e)=>{ const said = e.results[0][0].transcript; handleSymptomInput(said); };
  recognizer.onend = ()=>{ recognizing=false; };
  recognizer.onerror = (e)=>{ recognizing=false; setSymptomOutput('Voice error: '+e.error); };
  recognizer.start(); recognizing=true; setSymptomOutput('🎙️ Listening…');
}
function stopRecognition(){
  if(recognizer && recognizing){ recognizer.stop(); recognizing=false; }
  window.speechSynthesis.cancel(); /* also stops any ongoing voice reply */
}
document.getElementById('micBtn').addEventListener('click', startRecognition);
document.getElementById('stopMicBtn').addEventListener('click', stopRecognition);

/* ---------------- Gemini call (text + optional file) ----------------
   The API key never touches the browser. This just calls our own
   Flask backend at /api/gemini, which holds the key server-side. */
async function callGemini(promptText, filePart){
  try{
    const res = await fetch('/api/gemini', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt: promptText, filePart: filePart || null })
    });
    const data = await res.json();
    if(data.error) return {error: data.error};
    return {text: data.text || 'No response received.'};
  }catch(err){ return {error:'Network/API error: '+err.message}; }
}

/* ---------------- Severity badge heuristic ---------------- */
function badgeFor(text){
  const t = text.toLowerCase();
  if(t.includes('emergency') || t.includes('immediately') || t.includes('urgent'))
    return '<span class="badge danger">🔴 Urgent — seek care</span>';
  if(t.includes('doctor') || t.includes('see a physician') || t.includes('consult'))
    return '<span class="badge warn">🟡 Monitor — consult if it continues</span>';
  return '<span class="badge ok">🟢 Likely manageable at home</span>';
}

/* ---------------- Report analysis ---------------- */
let uploadedFilePart = null, uploadedFileName = '';
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', ()=>{
  const file = fileInput.files[0];
  if(!file) return;
  uploadedFileName = file.name;
  const reader = new FileReader();
  reader.onload = ()=>{
    const base64 = reader.result.split(',')[1];
    uploadedFilePart = { mimeType: file.type, data: base64 };
    dropzone.textContent = '✅ ' + file.name + ' — ready to analyze';
    dropzone.classList.add('hasfile');
  };
  reader.readAsDataURL(file);
});

async function analyzeReport(){
  const hb = parseFloat(document.getElementById('hemoglobin').value)||null;
  const sugar = parseFloat(document.getElementById('sugar').value)||null;
  const chol = parseFloat(document.getElementById('cholesterol').value)||null;
  const sys = parseFloat(document.getElementById('bpSys').value)||null;
  const dia = parseFloat(document.getElementById('bpDia').value)||null;
  const bmi = parseFloat(document.getElementById('bmi').value)||null;
  const notes = document.getElementById('notes').value?.trim();
  const out = document.getElementById('reportOutput');

  if(!hb && !sugar && !chol && !sys && !bmi && !uploadedFilePart){
    out.textContent = '⚠️ Enter at least one value or upload a report first.';
    return;
  }
  out.textContent = '⏳ Analyzing with Gemini...';

  let prompt = `You are a cautious health information assistant, not a doctor.`;
  if(uploadedFilePart){
    prompt += ` The attached file is a lab/medical report. Read the values from it, then explain in
simple language what is in/out of normal range, general lifestyle suggestions, and clear signs
for when to see a doctor. Do NOT diagnose. Use short bullet points.`;
  } else {
    prompt += ` Given these lab values, explain in simple language what is in/out of normal range,
general lifestyle suggestions, and clear signs for when to see a doctor. Do NOT diagnose. Use
short bullet points.

Hemoglobin: ${hb ?? 'not provided'} g/dL
Fasting Blood Sugar: ${sugar ?? 'not provided'} mg/dL
Total Cholesterol: ${chol ?? 'not provided'} mg/dL
Blood Pressure: ${sys ?? '?'}/${dia ?? '?'} mmHg
BMI: ${bmi ?? 'not provided'}
Notes: ${notes || 'none'}`;
  }

  const result = await callGemini(prompt, uploadedFilePart);
  if(result.error){ out.textContent = result.error; return; }
  out.textContent = result.text;
  document.getElementById('pdfBtn').style.display = 'inline-flex';
  saveHistory('Report', uploadedFilePart ? uploadedFileName : 'Manual values entered');
}
document.getElementById('analyzeBtn').addEventListener('click', analyzeReport);
document.getElementById('clearBtn').addEventListener('click', ()=>{
  ['hemoglobin','sugar','cholesterol','bpSys','bpDia','bmi','notes'].forEach(id=>document.getElementById(id).value='');
  uploadedFilePart=null; uploadedFileName='';
  dropzone.textContent='📎 Click to choose a file — JPG, PNG or PDF';
  dropzone.classList.remove('hasfile');
  document.getElementById('reportOutput').textContent = 'Enter values or upload a report, then click Analyze.';
  document.getElementById('pdfBtn').style.display='none';
});
document.getElementById('pdfBtn').addEventListener('click', ()=>{
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14); doc.text('Uyir AI — Health Report Analysis', 14, 16);
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(document.getElementById('reportOutput').innerText, 180);
  doc.text(lines, 14, 28);
  doc.save('health-report-analysis.pdf');
});

/* ---------------- Symptom checker ---------------- */
function setSymptomOutput(text){ document.getElementById('symptomOutput').textContent = text; }
async function handleSymptomInput(said){
  if(!said || !said.trim()) return;
  document.getElementById('symptomBadge').innerHTML = '';

  if(isEmergency(said)){
    document.getElementById('symptomBadge').innerHTML = '<span class="badge danger">🔴 Possible emergency</span>';
    setSymptomOutput('This sounds like it could be a medical emergency.\n\nPlease call your local emergency number RIGHT NOW, or use the Emergency SOS page to alert someone immediately.\n\nDo not wait for further advice from this app.');
    speak('This may be an emergency. Please call emergency services immediately.');
    return;
  }

  setSymptomOutput('⏳ Thinking...');
  const prompt = `You are a cautious health information assistant, not a doctor.
The user said this symptom (English, Tamil, or mixed — respond in the language that matches
their input, or English if mixed): "${said}".
Give a short, clearly labeled response with: 1) likely general cause 2) safe OTC options
(generic names only) 3) home care steps 4) red flags meaning they should see a doctor urgently.
Do not diagnose. Keep the whole answer under 150 words.`;

  const result = await callGemini(prompt);
  if(result.error){ setSymptomOutput(result.error); return; }
  setSymptomOutput(result.text);
  document.getElementById('symptomBadge').innerHTML = badgeFor(result.text);
  speak(result.text);
  saveHistory('Symptom', said);
}
document.getElementById('symptomTextBtn').addEventListener('click', ()=>{
  handleSymptomInput(document.getElementById('symptomText').value);
});
document.getElementById('symptomText').addEventListener('keydown', (e)=>{
  if(e.key==='Enter') handleSymptomInput(document.getElementById('symptomText').value);
});

/* ----------------  reminder ---------------- */
let remInterval=null;
document.getElementById('startRem').addEventListener('click', ()=>{
  const mins = parseInt(document.getElementById('remMin').value)||60;
  const msg = document.getElementById('remMsg').value || 'Time to drink water 💧';
  if(remInterval) clearInterval(remInterval);
  remInterval = setInterval(()=>{ alert(msg); speak(msg); }, mins*60*1000);
  alert(`Reminder started: every ${mins} minutes.`);
});
document.getElementById('stopRem').addEventListener('click', ()=>{
  if(remInterval){ clearInterval(remInterval); remInterval=null; alert('Reminder stopped.'); }
});

/* ---------------- Emergency WhatsApp ---------------- */
function sendWhatsApp(withLocation){
  const num = document.getElementById('emNum').value.trim().replace(/\D/g,'');
  const name = document.getElementById('emName').value.trim() || 'A user';
  if(!num){ alert('Please enter an emergency WhatsApp number with country code.'); return; }
  if(!withLocation){
    const text = encodeURIComponent(`${name} needs your help right now. Please call.`);
    window.open(`https://wa.me/${num}?text=${text}`, '_blank'); return;
  }
  if(!navigator.geolocation){ alert('Geolocation not supported on this device/browser.'); return; }
  navigator.geolocation.getCurrentPosition((pos)=>{
    const {latitude:lat, longitude:lng} = pos.coords;
    const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
    const text = encodeURIComponent(`🚨 EMERGENCY: ${name} needs help. My live location: ${mapsLink}`);
    window.open(`https://wa.me/${num}?text=${text}`, '_blank');
  }, (err)=>alert('Could not get location: '+err.message), { enableHighAccuracy:true, timeout:10000 });
}
document.getElementById('emBtn').addEventListener('click', ()=>sendWhatsApp(true));
document.getElementById('testEmBtn').addEventListener('click', ()=>sendWhatsApp(false));
/* ================= STRESS RELIEF HUB ================= */
function showStressTab(tab){
  document.querySelectorAll('.stress-panel').forEach(p=>p.style.display='none');
  document.querySelectorAll('.stress-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById('stress-'+tab).style.display='block';
  document.querySelector(`.stress-tab[data-tab="${tab}"]`).classList.add('active');
  if(tab==='music' && !musicListBuilt) buildMusicList();
  if(tab==='balloon' && !balloonSpawner) startBalloonGame();
  if(tab==='memory' && !memoryBuilt){ buildMemoryGrid(); memoryBuilt = true; }
}

let breatheTimer=null;
function runBreatheCycle(){
  const circle = document.getElementById('breatheCircle');
  const text = document.getElementById('breatheText');
  const seq = [
    {label:'Breathe in...', scale:1.4, dur:4000},
    {label:'Hold...', scale:1.4, dur:2000},
    {label:'Breathe out...', scale:1, dur:4000}
  ];
  let i=0;
  function step(){
    const s = seq[i % seq.length];
    text.textContent = s.label;
    circle.style.transform = `scale(${s.scale})`;
    breatheTimer = setTimeout(()=>{ i++; step(); }, s.dur);
  }
  step();
}
document.getElementById('breatheStart').addEventListener('click', ()=>{
  if(breatheTimer) clearTimeout(breatheTimer);
  runBreatheCycle();
});
document.getElementById('breatheStop').addEventListener('click', ()=>{
  if(breatheTimer) clearTimeout(breatheTimer);
  document.getElementById('breatheText').textContent='Press Start';
  document.getElementById('breatheCircle').style.transform='scale(1)';
});

let balloonScore=0, balloonSpawner=null;
function spawnBalloon(){
  const area = document.getElementById('balloonArea');
  const b = document.createElement('div');
  b.className='balloon';
  b.style.left = Math.random()*90+'%';
  const colors=['#e8a33d','#4fa876','#e8614f','#f0c374'];
  b.style.background = colors[Math.floor(Math.random()*colors.length)];
  b.style.animationDuration = (4+Math.random()*3)+'s';
  b.onclick = ()=>{ balloonScore++; document.getElementById('balloonScore').textContent = balloonScore; b.remove(); };
  b.addEventListener('animationend', ()=> b.remove());
  area.appendChild(b);
}
function startBalloonGame(){
  document.getElementById('balloonArea').innerHTML='';
  balloonScore=0; document.getElementById('balloonScore').textContent=0;
  if(balloonSpawner) clearInterval(balloonSpawner);
  balloonSpawner = setInterval(spawnBalloon, 900);
}
document.getElementById('balloonReset').addEventListener('click', startBalloonGame);

let musicListBuilt=false;
const MUSIC_TRACKS=[
  {name:'Calm Rain', file:'rain.mp3'},
  {name:'Ocean Waves', file:'ocean.mp3'},
  {name:'Soft Piano', file:'piano.mp3'}
];
function buildMusicList(){
  document.getElementById('musicList').innerHTML = MUSIC_TRACKS.map(t=>
    `<button class="chip" onclick="playTrack('${t.file}')">🎵 ${t.name}</button>`).join('');
  musicListBuilt=true;
}
function playTrack(file){
  const player = document.getElementById('musicPlayer');
  player.src = '/static/audio/' + file;
  player.play();
}

/* ================= MEDICINE REMINDER ================= */
let medicines = JSON.parse(localStorage.getItem('uyir_meds')||'[]');
function renderMedList(){
  document.getElementById('medList').innerHTML = medicines.map((m,i)=>
    `<div class="recent-item">💊 <b>${m.name}</b> — ${m.time} <button class="btn ghost" style="padding:4px 10px; margin-left:8px" onclick="removeMed(${i})">✕</button></div>`).join('');
}
function removeMed(i){ medicines.splice(i,1); localStorage.setItem('uyir_meds', JSON.stringify(medicines)); renderMedList(); }
document.getElementById('addMedBtn').addEventListener('click', ()=>{
  const name = document.getElementById('medName').value.trim();
  const time = document.getElementById('medTime').value;
  if(!name || !time){ alert('Enter medicine name and time.'); return; }
  medicines.push({name, time, lastFired:''});
  localStorage.setItem('uyir_meds', JSON.stringify(medicines));
  document.getElementById('medName').value=''; document.getElementById('medTime').value='';
  renderMedList();
});
renderMedList();
setInterval(()=>{
  const now = new Date();
  const nowStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const today = now.toDateString();
  medicines.forEach(m=>{
    if(m.time === nowStr && m.lastFired !== today){
      m.lastFired = today;
      localStorage.setItem('uyir_meds', JSON.stringify(medicines));
      alert('💊 Time to take: ' + m.name);
      speak('Time to take your medicine: ' + m.name);
    }
  });
}, 20000);

/* ================= AI CHAT BOT ================= */
let chatHistory = [];
let chatFilePart = null, chatFileName = '';
let chatRecognizer, chatRecognizing = false;

function speakChat(text){
  const outSel = document.getElementById('chatVoiceOut')?.value;
  if(outSel === 'off') return;
  const lang = document.getElementById('chatLang')?.value || 'en-IN';
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function addChatBubble(role, text){
  const wrap = document.getElementById('chatMessages');
  const b = document.createElement('div');
  b.className = 'chat-bubble ' + (role === 'user' ? 'user' : 'bot');
  b.textContent = text;
  wrap.appendChild(b);
  wrap.scrollTop = wrap.scrollHeight;
  return b;
}

document.getElementById('chatAttachBtn').addEventListener('click', ()=>{
  document.getElementById('chatFileInput').click();
});
document.getElementById('chatFileInput').addEventListener('change', ()=>{
  const file = document.getElementById('chatFileInput').files[0];
  if(!file) return;
  chatFileName = file.name;
  const reader = new FileReader();
  reader.onload = ()=>{
    const base64 = reader.result.split(',')[1];
    chatFilePart = { mimeType: file.type, data: base64 };
    const preview = document.getElementById('chatAttachPreview');
    preview.style.display = 'flex';
    preview.innerHTML = `📎 ${chatFileName} <button class="btn ghost" style="padding:2px 8px; margin-left:8px" id="chatAttachRemove">✕</button>`;
    document.getElementById('chatAttachRemove').addEventListener('click', ()=>{
      chatFilePart = null; chatFileName = '';
      preview.style.display = 'none'; preview.innerHTML = '';
    });
  };
  reader.readAsDataURL(file);
});

async function sendChatMessage(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text && !chatFilePart) return;

  addChatBubble('user', text || `📎 ${chatFileName}`);
  input.value = '';

  if(isEmergency(text)){
    const msg = 'This sounds like it could be a medical emergency. Please call your local emergency number RIGHT NOW, or use the Emergency SOS page immediately.';
    addChatBubble('bot', msg);
    speakChat(msg);
    return;
  }

  const thinking = addChatBubble('bot', '⏳ Thinking...');

  let historyText = chatHistory.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');
  let prompt = `You are a cautious health information assistant, not a doctor. Reply in the same
language the user used (English, Tamil, or mixed). If an image is attached (e.g. a skin condition
photo), look at it carefully and describe what you observe, possible general causes, safe home care,
and clear red flags meaning they should see a doctor. Do NOT diagnose. Keep answers short and clear,
using bullet points where useful.

Conversation so far:
${historyText}

User: ${text || '(see attached photo/file)'}`;

  const filePartToSend = chatFilePart;
  const result = await callGemini(prompt, filePartToSend);

  thinking.remove();
  if(result.error){
    addChatBubble('bot', result.error);
    return;
  }
  addChatBubble('bot', result.text);
  speakChat(result.text);

  chatHistory.push({role:'user', text: text || `[photo attached: ${chatFileName}]`});
  chatHistory.push({role:'bot', text: result.text});
  saveHistory('AI Chat', text || chatFileName || 'Chat message');

  chatFilePart = null; chatFileName = '';
  const preview = document.getElementById('chatAttachPreview');
  preview.style.display = 'none'; preview.innerHTML = '';
}
document.getElementById('chatSendBtn').addEventListener('click', sendChatMessage);
document.getElementById('chatInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') sendChatMessage();
});

function startChatRecognition(){
  const lang = document.getElementById('chatLang').value || 'en-IN';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ alert('Speech Recognition not supported. Try Chrome.'); return; }
  if(chatRecognizing) return;
  chatRecognizer = new SR(); chatRecognizer.lang = lang; chatRecognizer.interimResults = false; chatRecognizer.maxAlternatives = 1;
  chatRecognizer.onresult = (e)=>{
    const said = e.results[0][0].transcript;
    document.getElementById('chatInput').value = said;
    sendChatMessage();
  };
  chatRecognizer.onend = ()=>{ chatRecognizing = false; };
  chatRecognizer.onerror = (e)=>{ chatRecognizing = false; addChatBubble('bot', 'Voice error: ' + e.error); };
  chatRecognizer.start(); chatRecognizing = true;
}
function stopChatRecognition(){
  if(chatRecognizer && chatRecognizing){ chatRecognizer.stop(); chatRecognizing = false; }
  window.speechSynthesis.cancel();
}
document.getElementById('chatMicBtn').addEventListener('click', startChatRecognition);
document.getElementById('chatStopMicBtn').addEventListener('click', stopChatRecognition);

/* ================= DOODLE / SCRIBBLE PAD ================= */
const doodleCanvas = document.getElementById('doodleCanvas');
const doodleCtx = doodleCanvas.getContext('2d');
let doodling = false;
function doodlePos(e){
  const rect = doodleCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX-rect.left) * (doodleCanvas.width/rect.width), y: (clientY-rect.top) * (doodleCanvas.height/rect.height) };
}
function doodleStart(e){ doodling = true; const p = doodlePos(e); doodleCtx.beginPath(); doodleCtx.moveTo(p.x, p.y); }
function doodleMove(e){
  if(!doodling) return;
  const p = doodlePos(e);
  doodleCtx.lineWidth = 3; doodleCtx.lineCap = 'round';
  doodleCtx.strokeStyle = document.getElementById('doodleColor').value;
  doodleCtx.lineTo(p.x, p.y); doodleCtx.stroke();
}
function doodleEnd(){ doodling = false; }
doodleCanvas.addEventListener('mousedown', doodleStart);
doodleCanvas.addEventListener('mousemove', doodleMove);
doodleCanvas.addEventListener('mouseup', doodleEnd);
doodleCanvas.addEventListener('mouseleave', doodleEnd);
doodleCanvas.addEventListener('touchstart', (e)=>{ doodleStart(e); e.preventDefault(); });
doodleCanvas.addEventListener('touchmove', (e)=>{ doodleMove(e); e.preventDefault(); });
doodleCanvas.addEventListener('touchend', doodleEnd);
document.getElementById('doodleClear').addEventListener('click', ()=>{
  doodleCtx.clearRect(0,0,doodleCanvas.width, doodleCanvas.height);
});

/* ================= MEMORY MATCH GAME ================= */
let memoryMoves=0, memoryFlipped=[], memoryBuilt=false;
const MEMORY_EMOJIS = ['🍎','🍎','🌿','🌿','💧','💧','🌸','🌸','🍋','🍋','⭐','⭐'];
function shuffleArr(arr){ return arr.slice().sort(()=>Math.random()-0.5); }
function buildMemoryGrid(){
  const grid = document.getElementById('memoryGrid');
  const cards = shuffleArr(MEMORY_EMOJIS);
  memoryMoves = 0; memoryFlipped = [];
  document.getElementById('memoryMoves').textContent = 0;
  grid.innerHTML = cards.map((emoji, i)=>
    `<div class="memory-card" data-emoji="${emoji}" data-index="${i}" onclick="flipMemoryCard(${i})">?</div>`
  ).join('');
}
function flipMemoryCard(i){
  const cardEls = document.querySelectorAll('.memory-card');
  const card = cardEls[i];
  if(card.classList.contains('flipped') || card.classList.contains('matched')) return;
  if(memoryFlipped.length === 2) return;
  card.classList.add('flipped');
  card.textContent = card.dataset.emoji;
  memoryFlipped.push(i);
  if(memoryFlipped.length === 2){
    memoryMoves++;
    document.getElementById('memoryMoves').textContent = memoryMoves;
    const [a,b] = memoryFlipped;
    if(cardEls[a].dataset.emoji === cardEls[b].dataset.emoji){
      cardEls[a].classList.add('matched'); cardEls[b].classList.add('matched');
      memoryFlipped = [];
    } else {
      setTimeout(()=>{
        cardEls[a].classList.remove('flipped'); cardEls[a].textContent='?';
        cardEls[b].classList.remove('flipped'); cardEls[b].textContent='?';
        memoryFlipped = [];
      }, 700);
    }
  }
}
document.getElementById('memoryReset').addEventListener('click', buildMemoryGrid);

/* ================= GUIDED MEDITATION TIMER ================= */
let meditationMinutes = 3, meditationInterval = null, meditationSecondsLeft = 180;
document.querySelectorAll('.medi-len').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.medi-len').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    meditationMinutes = parseInt(btn.dataset.min);
    meditationSecondsLeft = meditationMinutes*60;
    updateMeditationDisplay();
  });
});
function updateMeditationDisplay(){
  const m = Math.floor(meditationSecondsLeft/60);
  const s = meditationSecondsLeft%60;
  document.getElementById('meditationTimer').textContent = String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
const MEDI_PROMPTS = ['Close your eyes gently.','Breathe in slowly through your nose.','Let your shoulders relax.','Breathe out slowly.','Just notice your breath.'];
document.getElementById('meditationStart').addEventListener('click', ()=>{
  if(meditationInterval) clearInterval(meditationInterval);
  meditationSecondsLeft = meditationMinutes*60;
  updateMeditationDisplay();
  speak('Starting a ' + meditationMinutes + ' minute meditation. Get comfortable.');
  let promptIndex = 0;
  meditationInterval = setInterval(()=>{
    meditationSecondsLeft--;
    updateMeditationDisplay();
    if(meditationSecondsLeft > 0 && meditationSecondsLeft % 30 === 0){
      speak(MEDI_PROMPTS[promptIndex % MEDI_PROMPTS.length]);
      promptIndex++;
    }
    if(meditationSecondsLeft <= 0){
      clearInterval(meditationInterval);
      speak('Meditation complete. Open your eyes when ready.');
    }
  }, 1000);
});
document.getElementById('meditationStop').addEventListener('click', ()=>{
  if(meditationInterval) clearInterval(meditationInterval);
  meditationSecondsLeft = meditationMinutes*60;
  updateMeditationDisplay();
  window.speechSynthesis.cancel();
});

/* ================= DOCTOR / HOSPITAL FINDER ================= */
function openMapsSearch(query){
  if(!navigator.geolocation){ alert('Geolocation not supported on this device/browser.'); return; }
  navigator.geolocation.getCurrentPosition((pos)=>{
    const {latitude:lat, longitude:lng} = pos.coords;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${lat},${lng},14z`;
    window.open(url, '_blank');
  }, (err)=>alert('Could not get location: '+err.message), { enableHighAccuracy:true, timeout:10000 });
}
document.getElementById('findHospitalBtn').addEventListener('click', ()=> openMapsSearch('hospitals near me'));
document.getElementById('findClinicBtn').addEventListener('click', ()=> openMapsSearch('clinics near me'));

/* ================= MEDICINE INFO LOOKUP ================= */
document.getElementById('medInfoBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('medInfoInput').value.trim();
  const out = document.getElementById('medInfoOutput');
  if(!name){ out.textContent = '⚠️ Enter a medicine name first.'; return; }
  out.textContent = '⏳ Looking up...';
  const prompt = `You are a cautious health information assistant, not a doctor. Give general public
information about the medicine "${name}": 1) common uses 2) typical adult dosage form (general,
not a prescription) 3) common side effects 4) key precautions/interactions 5) a clear note to
consult a doctor or pharmacist before use. Keep it short, bullet points, under 180 words. If this
is not a recognized medicine name, say so clearly.`;
  const result = await callGemini(prompt);
  out.textContent = result.error || result.text;
  if(!result.error) saveHistory('Medicine Info', name);
});
document.getElementById('medInfoInput').addEventListener('keydown', (e)=>{
  if(e.key==='Enter') document.getElementById('medInfoBtn').click();
});

/* ================= APPOINTMENT REMINDER ================= */
let appointments = JSON.parse(localStorage.getItem('uyir_appts')||'[]');
function renderApptList(){
  document.getElementById('apptList').innerHTML = appointments.map((a,i)=>
    `<div class="recent-item">📅 <b>${a.name}</b> — ${a.date} ${a.time} <button class="btn ghost" style="padding:4px 10px; margin-left:8px" onclick="removeAppt(${i})">✕</button></div>`).join('');
}
function removeAppt(i){ appointments.splice(i,1); localStorage.setItem('uyir_appts', JSON.stringify(appointments)); renderApptList(); }
document.getElementById('addApptBtn').addEventListener('click', ()=>{
  const name = document.getElementById('apptName').value.trim();
  const date = document.getElementById('apptDate').value;
  const time = document.getElementById('apptTime').value;
  if(!name || !date || !time){ alert('Enter doctor/purpose, date and time.'); return; }
  appointments.push({name, date, time, fired:false});
  localStorage.setItem('uyir_appts', JSON.stringify(appointments));
  document.getElementById('apptName').value=''; document.getElementById('apptDate').value=''; document.getElementById('apptTime').value='';
  renderApptList();
});
renderApptList();
setInterval(()=>{
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  appointments.forEach(a=>{
    if(a.date === dateStr && a.time === timeStr && !a.fired){
      a.fired = true;
      localStorage.setItem('uyir_appts', JSON.stringify(appointments));
      alert('📅 Appointment now: ' + a.name);
      speak('You have an appointment now: ' + a.name);
    }
  });
}, 20000);
