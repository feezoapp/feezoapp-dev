const STARS = [
  { w: 2, top: '12%', left: '18%', dur: '2.8s', delay: '0s' },
  { w: 3, top: '22%', left: '70%', dur: '3.5s', delay: '.5s' },
  { w: 2, top: '35%', left: '42%', dur: '2.4s', delay: '1s' },
  { w: 2, top: '8%', left: '85%', dur: '3.1s', delay: '.3s' },
  { w: 3, top: '55%', left: '10%', dur: '4s', delay: '1.4s' },
  { w: 2, top: '68%', left: '80%', dur: '2.9s', delay: '.8s' },
  { w: 2, top: '78%', left: '30%', dur: '3.4s', delay: '2s' },
  { w: 3, top: '48%', left: '60%', dur: '3.7s', delay: '.2s' },
  { w: 2, top: '88%', left: '55%', dur: '2.6s', delay: '1.6s' },
  { w: 2, top: '30%', left: '90%', dur: '3.3s', delay: '1.1s' },
  { w: 2, top: '62%', left: '38%', dur: '2.7s', delay: '.6s' },
  { w: 3, top: '18%', left: '50%', dur: '4.2s', delay: '2.3s' },
];

// Same starfield/meteor decoration LoginScreen uses, pulled out so every
// screen in the auth flow (login, signup steps, success) looks like one
// continuous experience instead of the background "resetting" between hops.
export default function AuthBackdrop() {
  return (
    <>
      {STARS.map((s, i) => (
        <div key={i} className="star" style={{ width: s.w, height: s.w, top: s.top, left: s.left, animationDuration: s.dur, animationDelay: s.delay }} />
      ))}
      {['m1', 'm2', 'm3', 'm4', 'm5'].map(m => <div key={m} className={`meteor ${m}`} />)}
    </>
  );
}
