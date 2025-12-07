
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import jsPDF from 'jspdf';
import { MAX_STORY_PAGES, BACK_COVER_PAGE, TOTAL_PAGES, INITIAL_PAGES, BATCH_SIZE, DECISION_PAGES, GENRES, TONES, LANGUAGES, ComicFace, Beat, Persona } from './types';
import { Setup } from './Setup';
import { Book } from './Book';
import { useApiKey } from './useApiKey';
import { ApiKeyDialog } from './ApiKeyDialog';

// --- Constants ---
const MODEL_V3 = "gemini-3-pro-image-preview";
const MODEL_IMAGE_GEN_NAME = MODEL_V3;
const MODEL_TEXT_NAME = MODEL_V3;

// --- Components ---

const PersistentFooter: React.FC<{ 
    onDownloadPDF: () => void;
    onDownloadVideo: () => void;
    isExporting: boolean; 
}> = ({ onDownloadPDF, onDownloadVideo, isExporting }) => (
    <div className="fixed bottom-0 inset-x-0 z-[100] bg-black border-t-4 border-yellow-400 p-2 md:p-3 flex justify-between items-center shadow-[0_-5px_15px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom duration-500">
        <div className="hidden md:flex flex-col items-start pl-2">
             <span className="font-comic text-white text-lg tracking-wide uppercase">My Collection</span>
             <span className="text-xs text-gray-500 font-mono uppercase">Save your progress</span>
        </div>
        
        <div className="flex gap-3 mx-auto md:absolute md:left-1/2 md:-translate-x-1/2">
             <button onClick={onDownloadPDF} className="comic-btn bg-white text-black px-4 py-2 text-sm md:text-base hover:bg-gray-200 flex items-center gap-2 font-bold uppercase transition-transform active:scale-95" title="Download Comic as PDF">
                 <span>📄</span> <span className="hidden sm:inline">Save PDF</span>
             </button>
             <button onClick={onDownloadVideo} disabled={isExporting} className="comic-btn bg-blue-600 text-white px-4 py-2 text-sm md:text-base hover:bg-blue-500 disabled:bg-gray-600 flex items-center gap-2 font-bold uppercase transition-transform active:scale-95" title="Create Video Slideshow">
                 <span>{isExporting ? '⏳' : '🎥'}</span> <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'Save Video'}</span>
             </button>
        </div>

        <div className="hidden md:flex flex-col items-end pr-2 font-comic text-white">
            <span className="text-yellow-400">Powered by Gemini</span>
            <a href="https://x.com/ammaar" target="_blank" rel="noopener noreferrer" className="text-gray-500 text-xs hover:text-white transition-colors">@ammaar</a>
        </div>
    </div>
);

const App: React.FC = () => {
  // --- API Key Hook ---
  const { validateApiKey, setShowApiKeyDialog, showApiKeyDialog, handleApiKeyDialogContinue } = useApiKey();

  const [hero, setHeroState] = useState<Persona | null>(null);
  const [friend, setFriendState] = useState<Persona | null>(null);
  const [rival, setRivalState] = useState<Persona | null>(null);
  
  // Custom Names
  const [heroName, setHeroName] = useState("Hero");
  const [friendName, setFriendName] = useState("Partner");
  const [rivalName, setRivalName] = useState("Villain");

  const [selectedGenre, setSelectedGenre] = useState(GENRES[0]);
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0].code);
  const [customPremise, setCustomPremise] = useState("");
  const [storyTone, setStoryTone] = useState(TONES[0]);
  const [richMode, setRichMode] = useState(true);
  
  const heroRef = useRef<Persona | null>(null);
  const friendRef = useRef<Persona | null>(null);
  const rivalRef = useRef<Persona | null>(null);

  const setHero = (p: Persona | null) => { setHeroState(p); heroRef.current = p; };
  const setFriend = (p: Persona | null) => { setFriendState(p); friendRef.current = p; };
  const setRival = (p: Persona | null) => { setRivalState(p); rivalRef.current = p; };
  
  const [comicFaces, setComicFaces] = useState<ComicFace[]>([]);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // --- Transition States ---
  const [showSetup, setShowSetup] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const generatingPages = useRef(new Set<number>());
  const historyRef = useRef<ComicFace[]>([]);

  // --- AI Helpers ---
  // Helper to always get a fresh instance with the selected key
  const getAI = () => {
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  };

  const handleAPIError = (e: any) => {
    const msg = String(e);
    console.error("API Error:", msg);
    if (
      msg.includes('Requested entity was not found') || 
      msg.includes('API_KEY_INVALID') || 
      msg.toLowerCase().includes('permission denied')
    ) {
      setShowApiKeyDialog(true);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const generateBeat = async (history: ComicFace[], isRightPage: boolean, pageNum: number, isDecisionPage: boolean): Promise<Beat> => {
    if (!heroRef.current) throw new Error("No Hero");

    const isFinalPage = pageNum === MAX_STORY_PAGES;
    const langName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || "English";

    // Names for prompt
    const hName = heroName.trim() || "Hero";
    const fName = friendName.trim() || "Partner";
    const rName = rivalName.trim() || "Villain";

    // Get relevant history and last focus to prevent repetition
    const relevantHistory = history
        .filter(p => p.type === 'story' && p.narrative && (p.pageIndex || 0) < pageNum)
        .sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

    const lastBeat = relevantHistory[relevantHistory.length - 1]?.narrative;
    const lastFocus = lastBeat?.focus_char || 'none';

    const historyText = relevantHistory.map(p => 
      `[Page ${p.pageIndex}] [Focus: ${p.narrative?.focus_char}] (Caption: "${p.narrative?.caption || ''}") (Dialogue: "${p.narrative?.dialogue || ''}") (Scene: ${p.narrative?.scene}) ${p.resolvedChoice ? `-> USER CHOICE: "${p.resolvedChoice}"` : ''}`
    ).join('\n');

    // Aggressive Co-Star Injection Logic
    let friendInstruction = "Not yet introduced.";
    if (friendRef.current) {
        friendInstruction = `ACTIVE and PRESENT. Name is "${fName}".`;
        // If the last panel wasn't the friend, strongly suggest switching to them to maintain balance.
        if (lastFocus !== 'friend' && Math.random() > 0.4) {
             friendInstruction += " MANDATORY: FOCUS ON THIS CO-STAR FOR THIS PANEL.";
        } else {
             friendInstruction += " Ensure they are woven into the scene even if not the main focus.";
        }
    }

    // Rival Injection Logic
    let rivalInstruction = "Not yet introduced.";
    if (rivalRef.current) {
        rivalInstruction = `ACTIVE and PRESENT. Name is "${rName}". This is the ANTAGONIST or RIVAL.`;
        if (lastFocus !== 'rival' && Math.random() > 0.6) {
             rivalInstruction += " CONSIDER FOCUSING ON THIS RIVAL FOR THIS PANEL to add conflict.";
        }
    }

    // Determine Core Story Driver (Genre vs Custom Premise)
    let coreDriver = `GENRE: ${selectedGenre}. TONE: ${storyTone}.`;
    if (selectedGenre === 'Custom') {
        coreDriver = `STORY PREMISE: ${customPremise || "A totally unique, unpredictable adventure"}. (Follow this premise strictly over standard genre tropes).`;
    }
    
    const isSliceOfLife = selectedGenre.includes("Comedy") || selectedGenre.includes("Teen") || selectedGenre.includes("Slice");

    // Guardrails to prevent everything becoming "Quantum Sci-Fi"
    const guardrails = `
    NEGATIVE CONSTRAINTS:
    1. UNLESS GENRE IS "Dark Sci-Fi" OR "Superhero Action" OR "Custom": DO NOT use technical jargon like "Quantum", "Timeline", "Portal", "Multiverse", or "Singularity".
    2. IF GENRE IS "Teen Drama" OR "Lighthearted Comedy": The "stakes" must be SOCIAL, EMOTIONAL, or PERSONAL (e.g., a rumor, a competition, a broken promise, being late, embarrassing oneself). Do NOT make it life-or-death. Keep it grounded.
    3. Avoid "The artifact" or "The device" unless established earlier.
    `;

    // BASE INSTRUCTION: Strictly enforce language for output text.
    let instruction = `Continue the story. ALL OUTPUT TEXT (Captions, Dialogue, Choices) MUST BE IN ${langName.toUpperCase()}. ${coreDriver} ${guardrails}`;
    if (richMode) {
        instruction += " RICH/NOVEL MODE ENABLED. Prioritize deeper character thoughts, descriptive captions, and meaningful dialogue exchanges over short punchlines.";
    }

    if (isFinalPage) {
        instruction += " FINAL PAGE. KARMIC CLIFFHANGER REQUIRED. You MUST explicitly reference the User's choice from PAGE 3 in the narrative and show how that specific philosophy led to this conclusion. Text must end with 'TO BE CONTINUED...' (or localized equivalent).";
    } else if (isDecisionPage) {
        instruction += " End with a PSYCHOLOGICAL choice about VALUES, RELATIONSHIPS, or RISK. (e.g., Truth vs. Safety, Forgive vs. Avenge). The options must NOT be simple physical actions like 'Go Left'.";
    } else {
        // Neutralized Narrative Arc to avoid forcing "scary mystery" tones if the genre doesn't call for it.
        if (pageNum === 1) {
            instruction += " INCITING INCIDENT. An event disrupts the status quo. Establish the genre's intended mood. (If Slice of Life: A social snag/surprise. If Adventure: A call to action).";
        } else if (pageNum <= 4) {
            instruction += " RISING ACTION. The heroes engage with the new situation. Focus on dialogue, character dynamics, and initial challenges.";
        } else if (pageNum <= 8) {
            instruction += " COMPLICATION. A twist occurs! A secret is revealed, a misunderstanding deepens, or the path is blocked. (Keep intensity appropriate to Genre - e.g. Social awkwardness for Comedy, Danger for Horror).";
        } else {
            instruction += " CLIMAX. The confrontation with the main conflict. The truth comes out, the contest ends, or the battle is fought.";
        }
    }

    // Dynamic text limits based on richMode
    const capLimit = richMode ? "max 35 words. Detailed narration or internal monologue" : "max 15 words";
    const diaLimit = richMode ? "max 30 words. Rich, character-driven speech" : "max 12 words";

    const prompt = `
You are writing a comic book script. PAGE ${pageNum} of ${MAX_STORY_PAGES}.
TARGET LANGUAGE FOR TEXT: ${langName} (CRITICAL: CAPTIONS, DIALOGUE, CHOICES MUST BE IN THIS LANGUAGE).
${coreDriver}

CHARACTERS:
- HERO: Name is "${hName}". Active.
- CO-STAR: ${friendInstruction}
- RIVAL/EXTRA: ${rivalInstruction}

PREVIOUS PANELS (READ CAREFULLY):
${historyText.length > 0 ? historyText : "Start the adventure."}

RULES:
1. NO REPETITION. Do not use the same captions or dialogue from previous pages.
2. IF CO-STAR or RIVAL is active, THEY MUST APPEAR FREQUENTLY.
3. VARIETY. If page ${pageNum-1} was an action shot, make this one a reaction or wide shot.
4. LANGUAGE: All user-facing text MUST be in ${langName}.
5. Use the specific character names "${hName}", "${fName}", "${rName}" in dialogue and scene descriptions instead of "Hero" or "Sidekick".

INSTRUCTION: ${instruction}

OUTPUT STRICT JSON ONLY (No markdown formatting):
{
  "caption": "Unique narrator text in ${langName}. (${capLimit}).",
  "dialogue": "Unique speech in ${langName}. (${diaLimit}). Optional.",
  "scene": "Vivid visual description (ALWAYS IN ENGLISH for the artist model). MUST mention '${hName}' or '${fName}' or '${rName}' if they are present.",
  "focus_char": "hero" OR "friend" OR "rival" OR "other",
  "choices": ["Option A in ${langName}", "Option B in ${langName}"] (Only if decision page)
}
`;
    try {
        const ai = getAI();
        const res = await ai.models.generateContent({ model: MODEL_TEXT_NAME, contents: prompt, config: { responseMimeType: 'application/json' } });
        let rawText = res.text || "{}";
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(rawText);
        
        if (parsed.dialogue) parsed.dialogue = parsed.dialogue.replace(/^[\w\s\-]+:\s*/i, '').replace(/["']/g, '').trim();
        if (parsed.caption) parsed.caption = parsed.caption.replace(/^[\w\s\-]+:\s*/i, '').trim();
        if (!isDecisionPage) parsed.choices = [];
        if (isDecisionPage && !isFinalPage && (!parsed.choices || parsed.choices.length < 2)) parsed.choices = ["Option A", "Option B"];
        if (!['hero', 'friend', 'rival', 'other'].includes(parsed.focus_char)) parsed.focus_char = 'hero';

        return parsed as Beat;
    } catch (e) {
        console.error("Beat generation failed", e);
        handleAPIError(e);
        return { 
            caption: pageNum === 1 ? "It began..." : "...", 
            scene: `Generic scene for page ${pageNum}.`, 
            focus_char: 'hero', 
            choices: [] 
        };
    }
  };

  const generatePersona = async (desc: string): Promise<Persona> => {
      const style = selectedGenre === 'Custom' ? "Modern American comic book art" : `${selectedGenre} comic`;
      try {
          const ai = getAI();
          const res = await ai.models.generateContent({
              model: MODEL_IMAGE_GEN_NAME,
              contents: { text: `STYLE: Masterpiece ${style} character sheet, detailed ink, neutral background. FULL BODY. Character: ${desc}` },
              config: { imageConfig: { aspectRatio: '1:1' } }
          });
          const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (part?.inlineData?.data) return { base64: part.inlineData.data, desc };
          throw new Error("Failed");
      } catch (e) { 
        handleAPIError(e);
        throw e; 
      }
  };

  const generateImage = async (beat: Beat, type: ComicFace['type']): Promise<string> => {
    // Names for prompt linking
    const hName = heroName.trim() || "Hero";
    const fName = friendName.trim() || "Partner";
    const rName = rivalName.trim() || "Villain";

    const contents = [];
    if (heroRef.current?.base64) {
        contents.push({ text: `REFERENCE 1 [${hName} / HERO]:` });
        contents.push({ inlineData: { mimeType: 'image/jpeg', data: heroRef.current.base64 } });
    }
    if (friendRef.current?.base64) {
        contents.push({ text: `REFERENCE 2 [${fName} / CO-STAR]:` });
        contents.push({ inlineData: { mimeType: 'image/jpeg', data: friendRef.current.base64 } });
    }
    if (rivalRef.current?.base64) {
        contents.push({ text: `REFERENCE 3 [${rName} / RIVAL]:` });
        contents.push({ inlineData: { mimeType: 'image/jpeg', data: rivalRef.current.base64 } });
    }

    const styleEra = selectedGenre === 'Custom' ? "Modern American" : selectedGenre;
    let promptText = `STYLE: ${styleEra} comic book art, detailed ink, vibrant colors. `;
    
    if (type === 'cover') {
        const langName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || "English";
        promptText += `TYPE: Comic Book Cover. TITLE: "INFINITE HEROES" (OR LOCALIZED TRANSLATION IN ${langName.toUpperCase()}). Main visual: Dynamic action shot of [${hName}] (Use REFERENCE 1).`;
    } else if (type === 'back_cover') {
        promptText += `TYPE: Comic Back Cover. FULL PAGE VERTICAL ART. Dramatic teaser. Text: "NEXT ISSUE SOON".`;
    } else {
        promptText += `TYPE: Vertical comic panel. SCENE: ${beat.scene}. `;
        promptText += `INSTRUCTIONS: Maintain strict character likeness. `;
        promptText += `If scene mentions '${hName}' or 'HERO', you MUST use REFERENCE 1. `;
        promptText += `If scene mentions '${fName}' or 'CO-STAR' or 'SIDEKICK', use REFERENCE 2. `;
        promptText += `If scene mentions '${rName}' or 'RIVAL' or 'VILLAIN', use REFERENCE 3.`;
        
        if (beat.caption) promptText += ` INCLUDE CAPTION BOX: "${beat.caption}"`;
        if (beat.dialogue) promptText += ` INCLUDE SPEECH BUBBLE: "${beat.dialogue}"`;
    }

    contents.push({ text: promptText });

    try {
        const ai = getAI();
        const res = await ai.models.generateContent({
          model: MODEL_IMAGE_GEN_NAME,
          contents: contents,
          config: { imageConfig: { aspectRatio: '2:3' } }
        });
        const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        return part?.inlineData?.data ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : '';
    } catch (e) { 
        handleAPIError(e);
        return ''; 
    }
  };

  const updateFaceState = (id: string, updates: Partial<ComicFace>) => {
      setComicFaces(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
      const idx = historyRef.current.findIndex(f => f.id === id);
      if (idx !== -1) historyRef.current[idx] = { ...historyRef.current[idx], ...updates };
  };

  const generateSinglePage = async (faceId: string, pageNum: number, type: ComicFace['type']) => {
      const isDecision = DECISION_PAGES.includes(pageNum);
      let beat: Beat = { scene: "", choices: [], focus_char: 'other' };

      if (type === 'cover') {
           // Cover beat is handled in generateImage
      } else if (type === 'back_cover') {
           beat = { scene: "Thematic teaser image", choices: [], focus_char: 'other' };
      } else {
           beat = await generateBeat(historyRef.current, pageNum % 2 === 0, pageNum, isDecision);
      }

      if (beat.focus_char === 'friend' && !friendRef.current && type === 'story') {
          try {
              const newSidekick = await generatePersona(selectedGenre === 'Custom' ? "A fitting sidekick for this story" : `Sidekick for ${selectedGenre} story.`);
              setFriend(newSidekick);
          } catch (e) { beat.focus_char = 'other'; }
      }
      
      updateFaceState(faceId, { narrative: beat, choices: beat.choices, isDecisionPage: isDecision });
      const url = await generateImage(beat, type);
      updateFaceState(faceId, { imageUrl: url, isLoading: false });
  };

  const generateBatch = async (startPage: number, count: number) => {
      const pagesToGen: number[] = [];
      for (let i = 0; i < count; i++) {
          const p = startPage + i;
          if (p <= TOTAL_PAGES && !generatingPages.current.has(p)) {
              pagesToGen.push(p);
          }
      }
      
      if (pagesToGen.length === 0) return;
      pagesToGen.forEach(p => generatingPages.current.add(p));

      const newFaces: ComicFace[] = [];
      pagesToGen.forEach(pageNum => {
          const type = pageNum === BACK_COVER_PAGE ? 'back_cover' : 'story';
          newFaces.push({ id: `page-${pageNum}`, type, choices: [], isLoading: true, pageIndex: pageNum });
      });

      setComicFaces(prev => {
          const existing = new Set(prev.map(f => f.id));
          return [...prev, ...newFaces.filter(f => !existing.has(f.id))];
      });
      newFaces.forEach(f => { if (!historyRef.current.find(h => h.id === f.id)) historyRef.current.push(f); });

      try {
          for (const pageNum of pagesToGen) {
               await generateSinglePage(`page-${pageNum}`, pageNum, pageNum === BACK_COVER_PAGE ? 'back_cover' : 'story');
               generatingPages.current.delete(pageNum);
          }
      } catch (e) {
          console.error("Batch generation error", e);
      } finally {
          pagesToGen.forEach(p => generatingPages.current.delete(p));
      }
  }

  const launchStory = async () => {
    // --- API KEY VALIDATION ---
    const hasKey = await validateApiKey();
    if (!hasKey) return; // Stop if cancelled or invalid
    
    if (!heroRef.current) return;
    if (selectedGenre === 'Custom' && !customPremise.trim()) {
        alert("Please enter a custom story premise.");
        return;
    }
    setIsTransitioning(true);
    
    let availableTones = TONES;
    if (selectedGenre === "Teen Drama / Slice of Life" || selectedGenre === "Lighthearted Comedy") {
        availableTones = TONES.filter(t => t.includes("CASUAL") || t.includes("WHOLESOME") || t.includes("QUIPPY"));
    } else if (selectedGenre === "Classic Horror") {
        availableTones = TONES.filter(t => t.includes("INNER-MONOLOGUE") || t.includes("OPERATIC"));
    }
    
    setStoryTone(availableTones[Math.floor(Math.random() * availableTones.length)]);

    const coverFace: ComicFace = { id: 'cover', type: 'cover', choices: [], isLoading: true, pageIndex: 0 };
    setComicFaces([coverFace]);
    historyRef.current = [coverFace];
    generatingPages.current.add(0);

    generateSinglePage('cover', 0, 'cover').finally(() => generatingPages.current.delete(0));
    
    setTimeout(async () => {
        setIsStarted(true);
        setShowSetup(false);
        setIsTransitioning(false);
        await generateBatch(1, INITIAL_PAGES);
        generateBatch(3, 3);
    }, 1100);
  };

  const handleChoice = async (pageIndex: number, choice: string) => {
      updateFaceState(`page-${pageIndex}`, { resolvedChoice: choice });
      const maxPage = Math.max(...historyRef.current.map(f => f.pageIndex || 0));
      if (maxPage + 1 <= TOTAL_PAGES) {
          generateBatch(maxPage + 1, BATCH_SIZE);
      }
  }

  const resetApp = () => {
      setIsStarted(false);
      setShowSetup(true);
      setComicFaces([]);
      setCurrentSheetIndex(0);
      historyRef.current = [];
      generatingPages.current.clear();
      setHero(null);
      setFriend(null);
      setRival(null);
      // Optional: Reset names or keep them? Keeping them is friendlier.
  };

  const downloadPDF = () => {
    const PAGE_WIDTH = 480;
    const PAGE_HEIGHT = 720;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [PAGE_WIDTH, PAGE_HEIGHT] });
    const pagesToPrint = comicFaces.filter(face => face.imageUrl && !face.isLoading).sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

    pagesToPrint.forEach((face, index) => {
        if (index > 0) doc.addPage([PAGE_WIDTH, PAGE_HEIGHT], 'portrait');
        if (face.imageUrl) doc.addImage(face.imageUrl, 'JPEG', 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    });
    doc.save('Infinite-Heroes-Issue.pdf');
  };

  const downloadVideo = async () => {
      if (isExporting) return;
      setIsExporting(true);
      
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480; 
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("No context");

        const stream = canvas.captureStream(30); // 30 FPS
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();

        const pagesToPrint = comicFaces.filter(face => face.imageUrl && !face.isLoading).sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

        // Draw background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const page of pagesToPrint) {
            if (!page.imageUrl) continue;
            const img = new Image();
            img.src = page.imageUrl;
            await new Promise((resolve) => { img.onload = resolve; });
            
            // Draw image fit to canvas
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Hold frame for 3 seconds
            await new Promise(r => setTimeout(r, 3000));
        }

        recorder.stop();
        await new Promise(r => { recorder.onstop = r; });

        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Infinite-Heroes-Slideshow.webm';
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
          console.error("Video export failed", e);
          alert("Video export failed. Browser might not support this feature.");
      } finally {
          setIsExporting(false);
      }
  };

  const handleHeroUpload = async (file: File) => {
       try { const base64 = await fileToBase64(file); setHero({ base64, desc: "The Main Hero" }); } catch (e) { alert("Hero upload failed"); }
  };
  const handleFriendUpload = async (file: File) => {
       try { const base64 = await fileToBase64(file); setFriend({ base64, desc: "The Sidekick/Rival" }); } catch (e) { alert("Friend upload failed"); }
  };
  const handleRivalUpload = async (file: File) => {
       try { const base64 = await fileToBase64(file); setRival({ base64, desc: "The Villain/Extra" }); } catch (e) { alert("Rival upload failed"); }
  };

  const handleSheetClick = (index: number) => {
      if (!isStarted) return;
      if (index === 0 && currentSheetIndex === 0) return;
      if (index < currentSheetIndex) setCurrentSheetIndex(index);
      else if (index === currentSheetIndex && comicFaces.find(f => f.pageIndex === index)?.imageUrl) setCurrentSheetIndex(prev => prev + 1);
  };

  return (
    <div className="comic-scene" style={{ paddingBottom: isStarted ? '80px' : '0' }}>
      {showApiKeyDialog && <ApiKeyDialog onContinue={handleApiKeyDialogContinue} />}
      
      <Setup 
          show={showSetup}
          isTransitioning={isTransitioning}
          hero={hero}
          friend={friend}
          rival={rival}
          heroName={heroName}
          friendName={friendName}
          rivalName={rivalName}
          selectedGenre={selectedGenre}
          selectedLanguage={selectedLanguage}
          customPremise={customPremise}
          richMode={richMode}
          onHeroUpload={handleHeroUpload}
          onFriendUpload={handleFriendUpload}
          onRivalUpload={handleRivalUpload}
          onHeroNameChange={setHeroName}
          onFriendNameChange={setFriendName}
          onRivalNameChange={setRivalName}
          onGenreChange={setSelectedGenre}
          onLanguageChange={setSelectedLanguage}
          onPremiseChange={setCustomPremise}
          onRichModeChange={setRichMode}
          onLaunch={launchStory}
      />
      
      <Book 
          comicFaces={comicFaces}
          currentSheetIndex={currentSheetIndex}
          isStarted={isStarted}
          isSetupVisible={showSetup && !isTransitioning}
          isExporting={isExporting}
          onSheetClick={handleSheetClick}
          onChoice={handleChoice}
          onOpenBook={() => setCurrentSheetIndex(1)}
          onDownloadPDF={downloadPDF}
          onDownloadVideo={downloadVideo}
          onReset={resetApp}
      />

      {isStarted && (
        <PersistentFooter 
            onDownloadPDF={downloadPDF} 
            onDownloadVideo={downloadVideo} 
            isExporting={isExporting} 
        />
      )}
    </div>
  );
};

export default App;
