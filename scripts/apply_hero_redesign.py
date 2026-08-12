from pathlib import Path
import re

path = Path("index.html")
text = path.read_text(encoding="utf-8")

CSS_MARKER = "/* ---------- HERO V2 / idea to figure ---------- */"
css = r'''

  /* ---------- HERO V2 / idea to figure ---------- */
  nav.wrap{
    height:90px;
  }
  .logo-mark{
    width:88px;
    height:88px;
  }
  section{
    scroll-margin-top:90px;
  }

  .hero.hero-v2{
    padding:58px 0 54px;
    min-height:calc(100vh - 90px);
    display:flex;
    align-items:center;
    overflow:hidden;
  }
  .hero-v2::after{
    content:"";
    position:absolute;
    inset:auto -12% -40% 35%;
    height:620px;
    background:radial-gradient(ellipse, rgba(109,40,217,0.13), transparent 66%);
    pointer-events:none;
  }
  .hero-v2-grid{
    position:relative;
    z-index:1;
    width:100%;
    max-width:1280px;
    display:grid;
    grid-template-columns:minmax(0,.82fr) minmax(570px,1.18fr);
    gap:54px;
    align-items:center;
  }
  .hero-v2-copy{
    max-width:560px;
  }
  .hero-v2-copy .eyebrow{
    margin-bottom:17px;
    color:var(--bronze);
  }
  .hero-v2-copy h1{
    font-size:clamp(2.75rem,4.7vw,4.35rem);
    line-height:1.02;
    letter-spacing:-0.025em;
    margin-bottom:24px;
    max-width:11ch;
  }
  .hero-v2-copy h1 em{
    display:inline;
    color:var(--violet-bright);
    text-shadow:0 0 32px rgba(167,139,250,.34);
  }
  .hero-v2-copy .lead{
    max-width:48ch;
    margin-bottom:30px;
    font-size:1.03rem;
    line-height:1.75;
    color:#c8bdd5;
  }
  .hero-v2-copy .hero-ctas{
    gap:12px;
  }
  .hero-v2-copy .btn{
    padding:14px 23px;
  }
  .hero-v2-copy .btn-primary{
    display:inline-flex;
    align-items:center;
    gap:8px;
  }
  .hero-v2-copy .btn-primary::after{
    content:"→";
    transition:transform .18s ease;
  }
  .hero-v2-copy .btn-primary:hover::after{
    transform:translateX(4px);
  }
  .hero-trust{
    display:flex;
    flex-wrap:wrap;
    gap:10px 22px;
    margin-top:27px;
    padding-top:20px;
    border-top:1px solid var(--line);
  }
  .hero-trust-item{
    display:flex;
    align-items:center;
    gap:8px;
    font-family:'JetBrains Mono', monospace;
    font-size:.72rem;
    color:var(--ink-dim);
  }
  .hero-trust-item::before{
    content:"◆";
    font-size:.5rem;
    color:var(--bronze);
  }

  .hero-journey{
    position:relative;
    min-height:530px;
    isolation:isolate;
  }
  .hero-journey::before{
    content:"";
    position:absolute;
    inset:7% 0 4% 4%;
    z-index:-2;
    background:
      linear-gradient(rgba(167,139,250,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(167,139,250,.035) 1px, transparent 1px);
    background-size:28px 28px;
    -webkit-mask-image:radial-gradient(ellipse at 58% 50%, #000 20%, transparent 76%);
    mask-image:radial-gradient(ellipse at 58% 50%, #000 20%, transparent 76%);
  }
  .journey-glow{
    position:absolute;
    z-index:-1;
    right:-12%;
    top:-6%;
    width:500px;
    height:500px;
    border-radius:50%;
    background:radial-gradient(circle, rgba(167,139,250,.26), rgba(109,40,217,.11) 38%, transparent 70%);
    filter:blur(4px);
  }
  .journey-card{
    position:absolute;
    overflow:hidden;
    background:linear-gradient(155deg, rgba(36,21,52,.94), rgba(18,10,26,.92));
    border:1px solid rgba(167,139,250,.22);
    box-shadow:0 20px 50px rgba(0,0,0,.32);
    transition:transform .25s ease, border-color .25s ease, box-shadow .25s ease;
  }
  .journey-card:hover{
    border-color:rgba(167,139,250,.7);
    box-shadow:0 24px 58px rgba(0,0,0,.4), 0 0 34px rgba(109,40,217,.18);
  }
  .journey-source{
    left:0;
    top:22px;
    width:232px;
    height:198px;
    transform:rotate(-2.2deg);
    z-index:2;
  }
  .journey-source:hover{
    transform:rotate(-2.2deg) translateY(-5px);
  }
  .journey-model{
    left:48px;
    bottom:24px;
    width:258px;
    height:232px;
    transform:rotate(1.5deg);
    z-index:3;
  }
  .journey-model:hover{
    transform:rotate(1.5deg) translateY(-5px);
  }
  .journey-final{
    right:-4px;
    top:0;
    width:360px;
    height:510px;
    z-index:4;
    border-color:rgba(167,139,250,.34);
    background:
      radial-gradient(circle at 50% 42%, rgba(167,139,250,.22), transparent 56%),
      linear-gradient(160deg, rgba(30,17,44,.9), rgba(15,8,22,.8));
  }
  .journey-final:hover{
    transform:translateY(-5px);
  }
  .journey-label{
    position:absolute;
    top:12px;
    left:12px;
    right:12px;
    z-index:3;
    display:flex;
    align-items:center;
    gap:9px;
    font-family:'JetBrains Mono', monospace;
    font-size:.66rem;
    letter-spacing:.08em;
    text-transform:uppercase;
    color:var(--ink-dim);
  }
  .journey-label b{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:26px;
    height:26px;
    border:1px solid rgba(201,162,75,.48);
    color:var(--bronze);
    font-weight:500;
    background:rgba(16,9,22,.72);
  }
  .journey-media{
    width:100%;
    height:100%;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
  }
  .journey-media img{
    width:100%;
    height:100%;
    display:block;
  }
  .journey-source .journey-media{
    padding-top:34px;
  }
  .journey-source .journey-media img{
    object-fit:cover;
    object-position:center;
    opacity:.9;
  }
  .journey-model .journey-media{
    padding:40px 8px 8px;
    background:radial-gradient(circle at 50% 55%, rgba(167,139,250,.12), transparent 62%);
  }
  .journey-model .journey-media img{
    object-fit:contain;
    filter:drop-shadow(0 10px 24px rgba(0,0,0,.42));
  }
  .journey-final .journey-media{
    padding:42px 4px 0;
  }
  .journey-final .journey-media img{
    object-fit:contain;
    transform:scale(1.07);
    filter:drop-shadow(0 18px 30px rgba(0,0,0,.45)) drop-shadow(0 0 32px rgba(167,139,250,.24));
  }
  .journey-final .journey-label{
    color:var(--ink);
  }
  .journey-final .journey-label b{
    border-color:rgba(167,139,250,.6);
    color:var(--violet-bright);
  }
  .journey-connector{
    position:absolute;
    z-index:5;
    height:1px;
    transform-origin:left center;
    background:linear-gradient(90deg, rgba(201,162,75,.15), rgba(201,162,75,.92));
    box-shadow:0 0 12px rgba(201,162,75,.25);
  }
  .journey-connector::after{
    content:"";
    position:absolute;
    right:-1px;
    top:50%;
    width:7px;
    height:7px;
    border-top:1px solid var(--bronze);
    border-right:1px solid var(--bronze);
    transform:translateY(-50%) rotate(45deg);
  }
  .connector-one{
    left:204px;
    top:197px;
    width:92px;
    transform:rotate(58deg);
  }
  .connector-two{
    left:284px;
    top:355px;
    width:94px;
    transform:rotate(-20deg);
  }
  .journey-caption{
    position:absolute;
    right:12px;
    bottom:-7px;
    z-index:6;
    font-family:'JetBrains Mono', monospace;
    font-size:.66rem;
    letter-spacing:.09em;
    text-transform:uppercase;
    color:var(--ink-faint);
  }
  .journey-caption strong{
    color:var(--bronze);
    font-weight:500;
  }

  @media (prefers-reduced-motion:no-preference){
    .journey-source{ animation:journey-in .7s ease .20s both; }
    .journey-model{ animation:journey-in .7s ease .32s both; }
    .journey-final{ animation:journey-in .9s ease .42s both; }
    @keyframes journey-in{
      from{ opacity:0; translate:0 18px; }
      to{ opacity:1; translate:0 0; }
    }
  }

  @media (max-width:1050px){
    .hero.hero-v2{
      min-height:auto;
      padding:54px 0 62px;
    }
    .hero-v2-grid{
      grid-template-columns:1fr;
      gap:36px;
      max-width:820px;
    }
    .hero-v2-copy{
      max-width:650px;
    }
    .hero-v2-copy h1{
      max-width:13ch;
    }
    .hero-journey{
      min-height:520px;
      max-width:680px;
      width:100%;
      margin:0 auto;
    }
  }

  @media (max-width:680px){
    nav.wrap{
      height:76px;
    }
    .logo-mark{
      width:74px;
      height:74px;
    }
    .nav-cta{
      padding:8px 13px;
      font-size:.73rem;
    }
    section{
      scroll-margin-top:76px;
    }
    .hero.hero-v2{
      padding:40px 0 46px;
    }
    .hero-v2-copy h1{
      font-size:clamp(2.35rem,12vw,3.3rem);
      max-width:12ch;
      margin-bottom:20px;
    }
    .hero-v2-copy .lead{
      font-size:.96rem;
      line-height:1.68;
      margin-bottom:25px;
    }
    .hero-v2-copy .hero-ctas{
      display:grid;
      grid-template-columns:1fr;
    }
    .hero-v2-copy .btn{
      text-align:center;
      justify-content:center;
    }
    .hero-trust{
      gap:9px 16px;
      margin-top:22px;
    }
    .hero-journey{
      min-height:0;
      display:grid;
      grid-template-columns:1fr;
      gap:14px;
      margin-top:4px;
    }
    .hero-journey::before,
    .journey-glow{
      inset:0;
    }
    .journey-card{
      position:relative;
      inset:auto;
      width:100%;
      transform:none;
    }
    .journey-card:hover{
      transform:none;
    }
    .journey-source{
      height:210px;
    }
    .journey-model{
      height:250px;
    }
    .journey-final{
      height:390px;
    }
    .journey-connector{
      position:relative;
      left:auto;
      top:auto;
      width:1px;
      height:28px;
      margin:0 auto;
      transform:none;
      background:linear-gradient(180deg, rgba(201,162,75,.18), rgba(201,162,75,.9));
    }
    .journey-connector::after{
      right:auto;
      left:50%;
      top:auto;
      bottom:-1px;
      transform:translateX(-50%) rotate(135deg);
    }
    .journey-caption{
      position:relative;
      right:auto;
      bottom:auto;
      text-align:center;
      margin-top:3px;
    }
  }
'''

if CSS_MARKER not in text:
    text = text.replace("</style>", css + "\n</style>", 1)

new_hero = r'''  <!-- HERO -->
  <section class="hero hero-v2">
    <div class="wrap hero-v2-grid">
      <div class="hero-copy hero-v2-copy">
        <div class="eyebrow">Od pomysłu do figurki</div>
        <h1>Zamień swoją postać <em>w prawdziwą figurkę.</em></h1>
        <p class="lead">Wyślij opis, szkic, kartę postaci lub zdjęcia. Stworzymy model 3D, pokażemy Ci go do akceptacji i dopiero potem zamienimy go w gotową figurkę z żywicy.</p>
        <div class="hero-ctas">
          <a href="#zamow" class="btn btn-primary">Stwórz swoją figurkę</a>
          <a href="#prace" class="btn btn-ghost">Zobacz realizacje</a>
        </div>
        <div class="hero-trust" aria-label="Najważniejsze informacje">
          <div class="hero-trust-item">Model 3D do akceptacji</div>
          <div class="hero-trust-item">Darmowe poprawki</div>
          <div class="hero-trust-item">Druk z żywicy</div>
        </div>
      </div>

      <div class="hero-journey" aria-label="Jak pomysł zmienia się w gotową figurkę">
        <div class="journey-glow" aria-hidden="true"></div>

        <div class="journey-card journey-source">
          <div class="journey-label"><b>01</b><span>Twój pomysł</span></div>
          <div class="journey-media">
            <img src="lewzdjklienta.png" alt="Materiał referencyjny przesłany przez klienta">
          </div>
        </div>

        <div class="journey-connector connector-one" aria-hidden="true"></div>

        <div class="journey-card journey-model">
          <div class="journey-label"><b>02</b><span>Projekt 3D</span></div>
          <div class="journey-media">
            <img src="lewmodelpog.png" alt="Model poglądowy 3D przygotowany przez AXI">
          </div>
        </div>

        <div class="journey-connector connector-two" aria-hidden="true"></div>

        <div class="journey-card journey-final">
          <div class="journey-label"><b>03</b><span>Gotowa figurka</span></div>
          <div class="journey-media">
            <img src="lewbeztlaproces.png" alt="Gotowa wydrukowana figurka lwa wojownika">
          </div>
        </div>

        <div class="journey-caption"><strong>Prawdziwa realizacja AXI</strong> · od referencji do druku</div>
      </div>
    </div>
  </section>
'''

pattern = re.compile(
    r'''  <!-- HERO -->\n  <section class="hero">.*?</section>\n\n  <script>\n  document\.addEventListener\('DOMContentLoaded', function\(\)\{\n    var slides = document\.querySelectorAll\('\.hero-photo'\);.*?</script>\n''',
    re.S,
)

if 'class="hero hero-v2"' not in text:
    text, count = pattern.subn(new_hero + "\n", text, count=1)
    if count != 1:
        raise SystemExit("Could not locate the original hero block safely; no file was changed.")

path.write_text(text, encoding="utf-8")
print("Hero redesign applied.")
