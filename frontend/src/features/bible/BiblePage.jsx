import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Headphones, Loader2, Search } from "lucide-react";
import api from "../../api";
import { notifyError } from "../../utils/notifications";

const unwrap = (response) => response?.data ?? response;

export default function BiblePage() {
  const [translations, setTranslations] = useState([]);
  const [translationId, setTranslationId] = useState("en");
  const [books, setBooks] = useState([]);
  const [bookCode, setBookCode] = useState("");
  const [chapter, setChapter] = useState(1);
  const [passage, setPassage] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [pageError, setPageError] = useState("");

  async function loadTranslations() {
    const response = await api.get("/bible/translations", { notify: false });
    if (response?.ok) { setTranslations(unwrap(response) || []); setPageError(""); }
    else setPageError(response?.data?.message || response?.error || "Bible languages could not be loaded.");
  }

  useEffect(() => {
    loadTranslations();
  }, []);
  useEffect(() => {
    setPassage(null); setBooks([]); setBookCode(""); setAudioUrl("");
    api.get(`/bible/${encodeURIComponent(translationId)}/books`, { notify: false }).then((response) => {
      const rows = response?.ok ? unwrap(response) || [] : [];
      const firstAvailable = rows.find((book) => book.available);
      setBooks(rows); if (firstAvailable) { setBookCode(firstAvailable.code); setChapter(1); }
    });
  }, [translationId]);

  useEffect(() => {
    if (!bookCode) return;
    setLoading(true); setAudioUrl(""); setPageError("");
    api.get(`/bible/${encodeURIComponent(translationId)}/${encodeURIComponent(bookCode)}/${chapter}`, { notify: false })
      .then((response) => {
        if (response?.ok) setPassage(unwrap(response));
        else { setPassage(null); setPageError(response?.data?.message || response?.error || "This chapter could not be loaded."); }
      })
      .finally(() => setLoading(false));
  }, [translationId, bookCode, chapter]);

  const selectedBook = books.find((book) => book.code === bookCode);
  const selectedTranslation = translations.find((item) => item.id === translationId);
  const chapterOptions = useMemo(() => Array.from({ length: selectedBook?.chapters || 0 }, (_, i) => i + 1), [selectedBook]);

  async function search() {
    if (query.trim().length < 2) return;
    setLoading(true);
    const response = await api.get("/bible/search", { params: { translationId, q: query.trim() }, notify: false });
    setResults(response?.ok ? unwrap(response) || [] : []); setLoading(false);
  }

  async function playAudio() {
    if (!bookCode) return;
    setAudioLoading(true);
    try {
      const response = await api.post(`/bible/${encodeURIComponent(translationId)}/${encodeURIComponent(bookCode)}/${chapter}/audio`, {}, { responseType: "blob", notify: false });
      if (!response?.ok) throw new Error(response?.error || "Audio could not be generated.");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(response.data));
    } catch (error) { notifyError(error, "Bible audio could not be generated."); }
    finally { setAudioLoading(false); }
  }

  function openResult(result) { setResults([]); setQuery(""); setBookCode(result.bookCode); setChapter(result.chapter); }

  return <div className="bible-page">
    <section className="bible-hero">
      <div><span>MULTILINGUAL SCRIPTURE</span><h1><BookOpen /> Bible</h1><p>Read, search, and listen in English, Spanish, German, Hindi, Punjabi, and Tamil.</p></div>
    </section>

    <section className="bible-languages">
      {translations.map((item) => <button key={item.id} className={translationId === item.id ? "active" : ""} onClick={() => setTranslationId(item.id)}>
        <strong>{item.nativeName}</strong><span>{item.languageName}</span><em>{item.available ? `${item.verseCount.toLocaleString()} verses` : "Import required"}</em>
      </button>)}
    </section>

    <section className="bible-toolbar">
      <select value={bookCode} onChange={(e) => { setBookCode(e.target.value); setChapter(1); }}><option value="">Select book</option>{books.map((book) => <option key={book.code} value={book.code} disabled={!book.available}>{book.name}{book.available ? "" : " — content not imported"}</option>)}</select>
      <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))} disabled={!bookCode}>{chapterOptions.map((value) => <option key={value} value={value}>Chapter {value}</option>)}</select>
      <div className="bible-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search this translation"/><button onClick={search}>Search</button></div>
      <button className="bible-listen" onClick={playAudio} disabled={!passage || audioLoading}>{audioLoading ? <Loader2 className="spin" size={17}/> : <Headphones size={17}/>} Listen</button>
    </section>

    {audioUrl && <section className="bible-audio"><strong>Audio Bible · {selectedBook?.name} {chapter}</strong><audio src={audioUrl} controls autoPlay /></section>}
    {pageError && <section style={{marginTop:14,padding:"13px 16px",border:"1px solid #fecaca",borderRadius:10,background:"#fef2f2",color:"#b91c1c",fontWeight:700}}>{pageError}</section>}
    {results.length > 0 && <section className="bible-results"><h2>Search results</h2>{results.map((result, index) => <button key={`${result.bookCode}-${result.chapter}-${result.verse}-${index}`} onClick={() => openResult(result)}><strong>{result.bookName} {result.chapter}:{result.verse}</strong><span>{result.text}</span></button>)}</section>}

    <main className="bible-reader">
      {loading ? <div className="bible-empty"><Loader2 className="spin"/> Loading Scripture…</div> : passage ? <>
        <header><span>{selectedTranslation?.translationName}</span><h2>{passage.bookName} {passage.chapter}</h2>{selectedTranslation?.licenseName && <small>{selectedTranslation.licenseName}</small>}</header>
        <article>{passage.verses.map((verse) => <p key={verse.verse}><sup>{verse.verse}</sup>{verse.text}</p>)}</article>
      </> : <div className="bible-empty"><BookOpen size={42}/><h2>{selectedTranslation?.available ? "Select a book and chapter" : "Translation content is not installed"}</h2><p>Import an authorized JSON translation to make its text and audio available. Mahima does not bundle copyrighted Bible text without permission.</p></div>}
    </main>
    <style>{`
      .bible-page{max-width:1420px;margin:auto;padding:28px;color:#162033}.bible-hero{display:flex;justify-content:space-between;gap:20px;padding:28px;border-radius:20px;background:linear-gradient(135deg,#064e3b,#0f766e);color:white}.bible-hero span{font-size:12px;font-weight:800;letter-spacing:.12em;color:#a7f3d0}.bible-hero h1{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:36px}.bible-hero p{margin:0;color:#d1fae5}.bible-languages{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0}.bible-languages button{display:grid;gap:3px;padding:14px;border:1px solid #dbe5e1;border-radius:12px;background:white;text-align:left}.bible-languages button.active{border-color:#059669;background:#ecfdf5;box-shadow:0 6px 18px #05966920}.bible-languages span,.bible-languages em{font-size:12px;color:#64748b}.bible-languages em{font-style:normal}.bible-toolbar{display:grid;grid-template-columns:210px 150px 1fr auto;gap:10px;padding:14px;border:1px solid #dce6e3;border-radius:14px;background:white}.bible-toolbar select,.bible-search{border:1px solid #d8e2ea;border-radius:9px;background:white}.bible-toolbar select{padding:10px}.bible-search{display:flex;align-items:center;padding-left:11px}.bible-search input{flex:1;border:0;padding:10px;outline:0}.bible-search button,.bible-listen{border:0;border-radius:8px;background:#047857;color:white;font-weight:800;padding:10px 16px}.bible-listen{display:flex;align-items:center;gap:7px}.bible-audio{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:14px;padding:12px 18px;border-radius:12px;background:#ecfdf5}.bible-audio audio{width:min(650px,70%)}.bible-reader,.bible-results{margin-top:18px;border:1px solid #dce6e3;border-radius:18px;background:#fff}.bible-reader header{text-align:center;padding:25px;border-bottom:1px solid #edf2f0}.bible-reader header span,.bible-reader header small{display:block;color:#64748b}.bible-reader header h2{font:700 32px Georgia,serif;margin:6px}.bible-reader article{columns:2;column-gap:45px;padding:32px 45px;font:19px/1.8 Georgia,serif}.bible-reader article p{display:inline;margin:0}.bible-reader article sup{padding:0 5px;color:#059669;font:bold 11px sans-serif}.bible-empty{display:grid;place-items:center;text-align:center;min-height:330px;padding:35px;color:#64748b}.bible-results{padding:18px}.bible-results button{display:grid;width:100%;gap:4px;padding:12px;border:0;border-bottom:1px solid #edf2f0;background:white;text-align:left}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.bible-languages{grid-template-columns:repeat(2,1fr)}.bible-toolbar{grid-template-columns:1fr 1fr}.bible-search{grid-column:1/-1}.bible-reader article{columns:1;padding:24px}.bible-hero{flex-direction:column}}
    `}</style>
    <style>{`
      .bible-reader article p{display:block;margin:0 0 12px;break-inside:avoid}.bible-reader article sup{display:inline-block;min-width:28px}
      @media(max-width:640px){
        .bible-page{padding:12px 10px;width:100%;overflow-x:hidden}.bible-hero{padding:20px 16px;border-radius:14px}.bible-hero h1{font-size:29px}
        .bible-languages{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px}.bible-languages button{min-width:135px;scroll-snap-align:start}
        .bible-toolbar{display:flex;flex-direction:column;padding:10px}.bible-toolbar select,.bible-search,.bible-listen{width:100%;min-height:46px}.bible-search{padding-left:10px}.bible-search input{min-width:0}.bible-search button{padding:10px 12px}
        .bible-audio{align-items:stretch;flex-direction:column}.bible-audio audio{width:100%}.bible-reader header{padding:18px 12px}.bible-reader header h2{font-size:26px}.bible-reader article{columns:1;padding:20px 16px;font-size:18px;line-height:1.65}.bible-empty{min-height:240px;padding:24px 14px}
      }
    `}</style>
  </div>;
}
