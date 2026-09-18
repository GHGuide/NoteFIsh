// Sign in and sign up, in the companion design: the promise on the left, the form
// on the right. Google is a button and a promise for now; email and password work.
import React, { useState } from 'react';
import { api } from '../api.js';
import { LogoMark, Puff } from '../shell.jsx';
import './auth.css';

const GOOGLE = <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
const WAVE = [7, 13, 18, 10, 15, 8];

export default function AuthPage({ users = 0, open = true, local = false, onSignedIn, onSkip }) {
  const [mode, setMode] = useState(open && !users ? 'signup' : 'signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', agree: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const set = key => event => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = mode === 'signup' ? await api.signUp({ name: form.name, email: form.email, password: form.password }) : await api.signIn({ email: form.email, password: form.password });
      onSignedIn(result.user);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const google = () => setNote('Google sign-in is on its way. Use your email for now.');
  const signup = mode === 'signup';
  return <div className="au">
    <section className="au-left">
      <div className="au-lockup"><LogoMark size={24} /><span>NoteFish<span className="dot">.</span></span></div>
      <div className="au-promise">
        <span className="au-eyebrow">Call-centre desk</span>
        <h1>{signup ? 'One call. Two languages.' : 'Your voice, in their language.'}</h1>
        <p>{signup ? 'Read a minute aloud so the desk learns your voice. Your next call can be in any language.' : 'Answer callers in the language they speak, in a voice that is yours. Sign in to open your desk.'}</p>
      </div>
      {signup ? <ol className="au-steps"><li><i>01</i>Create your desk</li><li><i>02</i>Read one passage aloud, about a minute</li><li><i>03</i>Take your first call in their language</li></ol>
        : <div className="au-demo">
          <div className="au-cap"><span>Caller</span><p>I’ve been waiting for my delivery since this morning.</p><p className="sub"><b>FR</b>J’attends ma livraison depuis ce matin.</p></div>
          <div className="au-pill"><Puff variant="fish" color="#F3F1EC" size={20} face={false} /><span className="wave" aria-hidden="true">{WAVE.map((h, i) => <i key={i} style={{ height: h }} />)}</span><span>Listening</span><span className="dim">EN ← FR</span><kbd>hold ⌥</kbd></div>
        </div>}
    </section>
    <section className="au-right">
      <form className="au-form" onSubmit={submit}>
        <div className="au-head"><h2>{signup ? 'Create your desk' : 'Sign in'}</h2><p>{signup ? 'Once. The desk stays yours and there is nothing to sign out of.' : 'Your desk, your voice, your calls.'}</p></div>
        <button type="button" className="au-google" onClick={google} disabled={busy}>{GOOGLE}{signup ? 'Sign up with Google' : 'Continue with Google'}</button>
        <div className="au-or"><span />or<span /></div>
        {note && <p className="au-note" role="status">{note}</p>}
        {error && <p className="au-error" role="alert">{error}</p>}
        {signup && <label className="au-field"><span>Your name</span><input type="text" autoComplete="name" placeholder="Nina Okafor" value={form.name} onChange={set('name')} required maxLength={100} /></label>}
        <label className="au-field"><span>Work email</span><input type="email" autoComplete="email" placeholder="nina@acme.example" value={form.email} onChange={set('email')} required /></label>
        <label className="au-field"><span className="row">Password{!signup && <a href="#reset" onClick={event => { event.preventDefault(); setNote('Ask whoever runs this desk to reset your password.'); }}>Forgot it?</a>}</span><input type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 10 characters' : '••••••••••'} value={form.password} onChange={set('password')} required minLength={signup ? 10 : 1} /></label>
        {signup && <label className="au-check"><input type="checkbox" checked={form.agree} onChange={set('agree')} required /><span>I agree to the Terms and the Privacy Policy, and I will only clone a voice I own or have permission to use.</span></label>}
        <button type="submit" className="au-submit" disabled={busy}>{busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}</button>
        <p className="au-switch">{signup ? <>Already have a desk? <a href="#signin" onClick={event => { event.preventDefault(); setMode('signin'); setError(''); }}>Sign in</a></> : open ? <>New here? <a href="#signup" onClick={event => { event.preventDefault(); setMode('signup'); setError(''); }}>Create your desk</a></> : <>This desk already belongs to someone. Sign in above.</>}</p>
      </form>
      {local && onSkip && <p className="au-skip"><a href="#skip" onClick={event => { event.preventDefault(); onSkip(); }}>Skip for now</a><span>Only on this Mac. Remote desks need an account.</span></p>}
      <p className="au-legal">{signup ? 'Your recordings stay on your own server. Nothing is cloned without consent.' : 'A voice is only ever cloned with its owner’s consent. By continuing you agree to the Terms and the Privacy Policy.'}</p>
    </section>
  </div>;
}
