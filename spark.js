/* Find my spark: a self-contained, browser-local Cold Start add-on. */
(() => {
  'use strict';
  const KEY = 'coldstart.spark.v1';
  const CATEGORIES = {everyday:'Everyday things',making:'Make something',movement:'Movement',sounds:'Music & sounds',own:'My own task'};
  const APPROACHES = {easy:'Keep it easy',novel:'Make it novel',challenge:'Give me a challenge',company:'Alongside someone'};
  const IDEAS = {
    sounds: [
      ['Find a sound that catches you','Listen to up to three beats. Keep the one that makes you want to say something. Finding it can be the whole session.'],
      ['Try a tiny rap snippet','Put on a beat you already like. Try two lines or a short voice memo in your usual recording app. It does not need to become a full song.'],
      ['Follow one detail','Pick a sound in a beat: the bass, a melody, a texture. Try a few words or a flow that responds to it.']
    ],
    movement: [
      ['Move to one song','Choose a song and move in whatever way feels comfortable. See how you feel when it ends.'],
      ['Take a short change of scene','Walk or move somewhere nearby that feels comfortable. Notice one sound or detail you would normally pass by.'],
      ['Try something after movement','If you have just done cardio or moved around, try five minutes of sounds, making something, or an everyday task. Notice whether it feels different.']
    ],
    making: [
      ['Make one small thing','Write four lines, draw one object, or take one interesting photo. Choose one and keep it small.'],
      ['Collect a little inspiration','Choose three images, words, or sounds around one mood. Stop browsing after three and look at what you picked.'],
      ['Return to an unfinished idea','Open one thing you already started. Add or change a single detail. That can be enough for today.']
    ],
    everyday: [
      ['One surface, one song','Pick a small surface and one song. Put a few things where they belong. You can stop when the song ends.'],
      ['Find five things a home','Choose five objects that belong somewhere else. Move them one at a time. No need to clean the whole room.'],
      ['Make the next thing easier','Get one thing ready: a clear chair, tomorrow’s clothes, or something you need nearby. Choose what would actually help you.']
    ]
  };
  function taskPlan(task, reason, mode) {
    const title=String(task||'').trim().slice(0,160);
    if(!title) return null;
    const recipes=[
      [/clean|tidy|room|laundry|wash|dishes/i,'Pick one small area or five items.','Finish that one area or those five items.','Work through one category first, like clothes or cups.'],
      [/study|learn|read|homework|exam|revise/i,'Open one page or one question.','Find one useful idea and explain it in your own words.','Turn the material into a question you actually want answered.'],
      [/email|admin|bill|apply|application|form|paperwork/i,'Open one message, document, or form.','Draft one reply or fill one section; you can review it later.','Make it a sorting round: easy, needs thought, or waiting on someone.'],
      [/write|draw|song|rap|music|paint|design|code/i,'Open your materials and make one rough line, mark, or small edit.','Keep one tiny piece you like.','Try one deliberately different style or constraint.'],
      [/cook|meal|food|prep/i,'Choose one simple thing to prepare and get its ingredients out.','Complete one safe preparation step.','Try a small variation using something you already have.'],
      [/walk|exercise|cardio|stretch|workout/i,'Choose a comfortable kind of movement and get ready.','Try a short, comfortable amount and check how you feel.','Change the music or the setting, if it is safe and convenient.']
    ];
    const recipe=recipes.find(([pattern])=>pattern.test(title)) || [null,'Open or get out what you need. Choose the smallest visible part.','Make one small change you can point to.','Try a different order, setting, or tool you already have.'];
    const reasonText={boring:'Give it some interest: choose a soundtrack if it fits, or make a small prediction about what you will finish.',big:'Only this small piece counts for now. Leave the rest outside this round.',unclear:'Your first move is the setup step below. After that, choose one visible result.',flat:'Treat this as a short sample. You can switch approaches or stop if it still feels flat.'}[reason] || '';
    const twist={easy:'Keep the setup simple and skip any extra rules.',novel:recipe[3],challenge:'Use the finish line below as a small challenge. Speed is optional.',company:'If someone is available, do your own tasks alongside each other. No need to arrange a call to get started.'}[mode] || '';
    return {title,description:reasonText+' First move: '+recipe[1]+' Small finish line: '+recipe[2]+' '+twist};
  }
  const HOOKS={build:'Build & refine',compare:'Judge & compare',explore:'Explore through conversation'};
  const PROJECTS={
    taste:{hook:'compare',title:'Make your taste easier to explain',medium:'With or without a bot',intro:'Turn a feeling like “aura” into examples and rules that actually match your taste.',steps:[['Find the mismatch','Choose two characters, images, game moments, or scenes you know. What makes one feel stronger to you? You do not need to watch a whole movie.'],['Make one rule','Write one sentence that explains the difference. Use your own language, even if it would not make sense to everyone.'],['Try to break your rule','Find an example that your rule would rate wrong. What is missing: presence, restraint, atmosphere, something else?'],['Make a better version','Adjust one criterion in your rating app or notes. Test the same examples again and see whether you agree more.']],twists:{repetitive:'Find the strongest exception to your current taste rules. Explore what makes it an exception instead of rating more similar examples.',direction:'Pick one pair your ratings get wrong. Work only on explaining that mismatch.',setup:'Use two examples from memory and say the difference out loud. No scoring system or spreadsheet needed.',topic:'Keep the comparison idea but switch the subject: character designs, voices, places, outfits, or album covers.'}},
    collection:{hook:'compare',title:'Curate a collection with a point of view',medium:'Away from bots',intro:'Build a small collection that feels unmistakably like your taste. Its theme can evolve.',steps:[['Choose a feeling','Pick a mood or quality you want to collect: imposing, strange, calm, futuristic, or a word of your own.'],['Find three examples','Use images, objects, passages, or sounds you already have access to. Pick three that fit for different reasons.'],['Explain one surprise','Choose the least obvious item. Write why it belongs. Your explanation becomes part of the collection.'],['Give the collection shape','Arrange the items into an order, a page, or a physical display. Decide what kind of item would deepen it next.']],twists:{repetitive:'Look for one item that almost belongs but does not. Define the boundary instead of adding more items.',direction:'Choose your favorite item and find just one that creates an interesting contrast.',setup:'Use three things already around you. No new app or account needed.',topic:'Keep the collecting approach, but change the mood or medium completely.'}},
    app:{hook:'build',title:'Make one app feel right',medium:'With a bot',intro:'Use one of your existing apps. Follow the gap between what you imagined and what it actually does.',steps:[['Choose what feels off','Pick one interaction or result you dislike. Describe what you expected and what happened instead.'],['Give a concrete example','Create one input and the output you would want. It can be a rating, a story response, or an app screen.'],['Direct one change','Ask your coding bot to change just that behavior. Give it your example so it has a clear target.'],['Put the change to use','Try the same example, then one different example. Keep the improvement or explain the remaining mismatch.']],twists:{repetitive:'Stop adding features for a round. Try using the app for a real choice and find the first thing that gets in your way.',direction:'Complete this sentence: “When I do ___, I want ___.” Work on only that interaction.',setup:'Sketch the result or dictate how it should behave before opening the code.',topic:'Use the same design process on a different idea, or sketch a physical version on paper.'}},
    world:{hook:'build',title:'Design a world with rules',medium:'With or without a bot',intro:'Create a setting, character, or small game concept where your choices change what can happen.',steps:[['Choose one unusual rule','Decide what works differently in this world. For example: memories can be traded, or power comes with a visible cost.'],['Make someone who struggles with it','Create a character who wants something the rule makes difficult. Give them a specific immediate choice.'],['See what the rule causes','Write, draw, or ask a bot for one scene that follows your rule. Notice where the result surprises or disappoints you.'],['Deepen what interests you','Develop the consequence you liked most. Add a rival, place, or limitation that makes it more interesting.']],twists:{repetitive:'Change who has the advantage. Revisit the same situation from the other side.',direction:'Give your character two options with different costs and decide what they choose.',setup:'Describe a single scene out loud. You do not need maps, lore, or a complete story.',topic:'Keep the rule-making part but try a tabletop challenge, puzzle, or real-world game.'}},
    expert:{hook:'explore',title:'Test an expert’s way of thinking',medium:'With a bot',intro:'Use your expert character to explore a question you care about, then check what its answer rests on.',steps:[['Bring a real question','Pick something you actually disagree with, wonder about, or want to decide. Avoid starting with “teach me everything.”'],['Ask for a concrete case','Have the character apply its ideas to one example. Ask it to distinguish quoted source material from its own interpretation.'],['Push on the weak part','Ask what evidence would change its answer, or give it a counterexample. Check any claimed quotation in the actual book.'],['Keep your own conclusion','Write what persuaded you and what did not. Follow the unresolved question that interests you most.']],twists:{repetitive:'Ask for the strongest opposing explanation and compare it to the first answer.',direction:'Pick one claim and ask: “What would this predict in a real example?”',setup:'Use a single passage you already have. Ask one question about it.',topic:'Switch the subject while keeping the debate: art, storytelling, training, history, or another interest.'}},
    investigate:{hook:'explore',title:'Follow a question out into the world',medium:'Away from bots',intro:'Turn something you wonder about into a small investigation, using observation and sources you choose.',steps:[['Pick a question with some pull','Choose something you would like to understand about a place, design, story, or everyday object.'],['Find one useful clue','Observe it, read a relevant passage, or talk to someone who knows it. Write down one thing that changes your guess.'],['Compare explanations','Come up with two possible answers. Decide what observation or source could help tell them apart.'],['Make something from the discovery','Create a short note, photo series, diagram, or explanation for yourself. Let the next question grow out of it.']],twists:{repetitive:'Change the way you investigate: look, sketch, compare, or ask someone rather than watching another video.',direction:'Write one question that could be answered with a specific observation.',setup:'Investigate an object or detail already in the room. No trip or equipment required.',topic:'Keep the investigation, but choose a different subject you actually care about.'}}
  };
  function cleanProjects(raw){
    const output={};
    if(!raw||typeof raw!=='object')return output;
    for(const id of Object.keys(PROJECTS)){
      const p=raw[id];if(!p||typeof p!=='object')continue;
      output[id]={step:Number.isInteger(p.step)?Math.max(0,Math.min(3,p.step)):0,angle:['repetitive','direction','setup','topic'].includes(p.angle)?p.angle:'',note:String(p.note||'').slice(0,600),reactions:Array.isArray(p.reactions)?p.reactions.filter(x=>['more','repetitive','direction','setup','topic'].includes(x)).slice(-12):[]};
    }return output;
  }
  function nextProjectState(current, reaction){
    const p={step:0,angle:'',note:'',reactions:[],...current};
    if(reaction==='more'){p.step=(p.step+1)%4;p.angle='';}
    else if(['repetitive','direction','setup','topic'].includes(reaction))p.angle=reaction;
    else return p;
    p.reactions=[...p.reactions,reaction].slice(-12);return p;
  }
  let projectId=null,showBored=false;
  function projectChooser(){
    const hook=HOOKS[data.hook]?data.hook:'build';
    const cards=Object.entries(PROJECTS).filter(([,p])=>p.hook===hook);
    const saved=Object.keys(data.projects);
    return `<p class="sp-kicker">Room to keep exploring</p><h1 id="spark-heading" tabindex="-1">Find something to get into</h1><p class="sp-muted">Start with the part you like doing. These are directions to explore, not promises about how long you will stay interested.</p>
    <div class="sp-row" aria-label="What part appeals to you?">${Object.entries(HOOKS).map(([k,v])=>button('hook',v,`data-value="${k}" aria-pressed="${hook===k}"`)).join('')}</div>
    ${cards.map(([id,p])=>`<article class="sp-card"><p class="sp-kicker">${escape(p.medium)}</p><h2>${escape(p.title)}</h2><p>${escape(p.intro)}</p>${button('project-open',data.projects[id]?'Return to this':'Explore this',`data-id="${id}" class="sp-primary"`)}</article>`).join('')}
    ${saved.length?`<details><summary>My ongoing projects (${saved.length})</summary>${saved.map(id=>button('project-open',`<strong>${escape(PROJECTS[id].title)}</strong><span>${escape(data.projects[id].note||PROJECTS[id].steps[data.projects[id].step][0])}</span>`,`data-id="${id}" class="sp-return"`)).join('')}</details>`:''}
    <div class="sp-row">${button('own','Make my own task more appealing')}${button('discover','Browse small activities')}${button('choose','Back')}</div>`;
  }
  function projectView(){
    const p=PROJECTS[projectId],state=data.projects[projectId];
    if(!p||!state)return projectChooser();
    const step=p.steps[state.step];
    const feedback=state.reactions.length?state.reactions[state.reactions.length-1]:null;
    const labels={repetitive:'It feels repetitive',direction:'I need a direction',setup:'Too much setup',topic:'The topic is not doing it'};
    return `<p class="sp-kicker">${escape(HOOKS[p.hook])} · ${escape(p.medium)}</p><h1 id="spark-heading" tabindex="-1">${escape(p.title)}</h1><p class="sp-muted">${escape(p.intro)}</p>
    <article class="sp-card"><p class="sp-kicker">${state.angle?'A different angle':'Something to follow next'}</p><h2>${escape(state.angle?labels[state.angle]:step[0])}</h2><p>${escape(state.angle?p.twists[state.angle]:step[1])}</p></article>
    ${feedback?`<p class="sp-small sp-muted" role="status">${feedback==='more'?'You asked to go deeper. Your next direction is above.':'You changed the approach. Your next direction is above.'}</p>`:''}
    <div class="sp-row">${button('project-more',state.step===3?'Try another example':'More of this','class="sp-primary"')}${button('project-bored','This got boring',`aria-expanded="${showBored}"`)}</div>
    ${showBored?`<div class="sp-card"><h2>Which part?</h2><div class="sp-row">${Object.entries(labels).map(([k,v])=>button('project-angle',v,`data-value="${k}"`)).join('')}</div><p class="sp-small sp-muted">You can also leave this project and pick another one.</p></div>`:''}
    ${state.step===3&&!state.angle?'<p class="sp-muted">From here, repeat the part you liked with a new example, or leave your own next direction below.</p>':''}
    <label class="sp-label" for="spark-project-note">What caught you / where to return</label><textarea id="spark-project-note" maxlength="600" placeholder="The comparison was interesting. Next: find an example that breaks my rule.">${escape(state.note)}</textarea><p class="sp-small sp-muted">Saves as you type. No timer to complete.</p>
    <div class="sp-row">${button('project-ai','Adapt this with Claude')}${button('projects','Save & explore other directions')}${button('close','Leave it here')}</div>`;
  }

  const HELPERS = ['After cardio / movement','A sound I liked','A clear small challenge','A change of scene','Someone alongside me'];
  const RATINGS = {hooked:'Got into it',okay:'Okay',flat:'Nothing this time'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const remaining = (end, now = Date.now()) => Math.max(0, Math.ceil((end-now)/1000));
  const formatTime = seconds => `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  function cleanRecord(r) {
    if (!r || !CATEGORIES[r.category] || !RATINGS[r.rating] || !Number.isFinite(r.at)) return null;
    return {id:String(r.id || r.at).slice(0,80),category:r.category,approach:APPROACHES[r.approach]?r.approach:'easy',title:String(r.title||'Small experiment').slice(0,200),rating:r.rating,at:r.at,helpers:Array.isArray(r.helpers)?r.helpers.filter(x=>HELPERS.includes(x)):[],note:String(r.note||'').slice(0,600),reference:String(r.reference||'').slice(0,300)};
  }
  function cleanChat(raw){
    if(!Array.isArray(raw))return [];
    const pairs=[];
    for(let i=0;i+1<raw.length;i+=2){const u=raw[i],a=raw[i+1];if(u?.role==='user'&&a?.role==='assistant'&&typeof u.content==='string'&&typeof a.content==='string'&&u.content.trim()&&a.content.trim())pairs.push({role:'user',content:u.content.slice(0,3000)},{role:'assistant',content:a.content.slice(0,7000)});}
    return pairs.slice(-8);
  }
  function cleanData(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    let active = null;
    if (d.active && CATEGORIES[d.active.category] && Number.isFinite(d.active.end) && Number.isFinite(d.active.started)) {
      active = {...d.active,title:String(d.active.title||'Small experiment').slice(0,200),description:String(d.active.description||'').slice(0,1000),approach:APPROACHES[d.active.approach]?d.active.approach:'easy',checkAt:Number.isFinite(d.active.checkAt)?d.active.checkAt:Date.now()+1200000};
    }
    return {records:Array.isArray(d.records)?d.records.map(cleanRecord).filter(Boolean).slice(-200):[],active,checkins:d.checkins===true,projects:cleanProjects(d.projects),hook:HOOKS[d.hook]?d.hook:'build',chat:cleanChat(d.chat)};
  }
  function summarize(records) {
    return Object.entries(CATEGORIES).map(([key,label]) => ({key,label,total:records.filter(r=>r.category===key).length,hooked:records.filter(r=>r.category===key&&r.rating==='hooked').length})).filter(x=>x.total);
  }
  // Pure helpers are also usable for focused checks without a browser.
  if (typeof module !== 'undefined' && module.exports) module.exports = {remaining,formatTime,cleanData,summarize,escape,taskPlan,cleanProjects,nextProjectState,cleanChat};
  if (typeof document === 'undefined' || document.getElementById('spark-dialog')) return;
  let storageOK = true, data;
  try { data = cleanData(JSON.parse(localStorage.getItem(KEY)||'{}')); } catch { data = cleanData({}); storageOK=false; }
  let category='everyday', approach='easy', screen=data.active?'session':'welcome', currentRecord=null, lastFocus=null, noteDraft='', refDraft='', notice='';
  let ownTask='', ownReason='boring', ownReady=false;
  function save() {
    try { localStorage.setItem(KEY,JSON.stringify(data)); storageOK=true; } catch { storageOK=false; }
    const status=document.getElementById('spark-storage');
    if(status) status.textContent=storageOK?'Saved in this browser. Claude receives only the conversation you send.':'Browser saving is unavailable. Keep a copy of notes you want to retain.';
  }
  const style=document.createElement('style');
  style.textContent=`
  #spark-dialog{--sp-ink:var(--ink);--sp-muted:var(--dim);--sp-line:var(--rule);--sp-paper:var(--panel);--sp-green:var(--go);box-sizing:border-box;color:var(--sp-ink);background:var(--panel-2);border:1px solid var(--sp-line);border-radius:0;width:min(740px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:0;font:15.5px/1.55 "Hanken Grotesk","Helvetica Neue",Arial,sans-serif;overscroll-behavior:contain}
  #spark-dialog::backdrop{background:rgba(8,10,13,.72)}
  #spark-dialog *{box-sizing:border-box}#spark-dialog [hidden]{display:none!important}
  #spark-dialog .sp-head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--sp-line);padding:16px 24px;background:var(--panel-2)}
  #spark-dialog .sp-brand{font-size:14px;font-weight:700;letter-spacing:.04em}#spark-dialog .sp-brand::before{content:' ';display:inline-block;width:9px;height:9px;background:var(--signal);border-radius:50%;margin-right:8px}
  #spark-dialog .sp-body{padding:24px}#spark-dialog h1{font-family:"Bricolage Grotesque",Arial,sans-serif;font-variation-settings:"wdth" 92;font-weight:700;font-size:clamp(26px,5vw,34px);line-height:1.15;margin:0 0 12px;letter-spacing:-.03em}#spark-dialog h2{font-family:"Bricolage Grotesque",Arial,sans-serif;font-weight:700;font-size:21px;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em}#spark-dialog h3{font-size:18px;margin:0 0 8px}
  #spark-dialog p{margin:8px 0 16px}#spark-dialog .sp-muted{color:var(--sp-muted)}#spark-dialog .sp-small{font-size:14px}
  #spark-dialog button,#spark-launch{font:inherit;line-height:1.35;cursor:pointer;touch-action:manipulation}#spark-dialog button{border:1px solid var(--sp-line);border-radius:0;min-height:44px;background:var(--sp-paper);color:var(--sp-ink);padding:10px 14px;margin:0;box-shadow:none;text-transform:none;letter-spacing:normal}
  #spark-dialog button:hover{border-color:var(--dim);background:var(--panel-2)}#spark-dialog button:focus-visible,#spark-dialog input:focus-visible,#spark-dialog textarea:focus-visible,#spark-dialog summary:focus-visible,#spark-launch:focus-visible{outline:2px solid var(--signal);outline-offset:3px}
  #spark-dialog button[aria-pressed=true]{color:var(--panel)}#spark-dialog button[aria-pressed=true],#spark-dialog .sp-primary{background:var(--sp-green);color:var(--panel);border-color:var(--sp-green)}#spark-dialog .sp-primary:hover{filter:brightness(1.08)}#spark-dialog .sp-close{min-width:44px}
  #spark-dialog .sp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 20px}#spark-dialog .sp-card{border:1px solid var(--sp-line);border-left:3px solid var(--sp-green);background:var(--sp-paper);padding:20px;margin:12px 0;border-radius:0}
  #spark-dialog .sp-card p{color:var(--sp-muted)}#spark-dialog .sp-label{display:block;font-size:14px;font-weight:700;margin:20px 0 8px}#spark-dialog .sp-kicker{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:var(--sp-muted);letter-spacing:.07em;text-transform:uppercase;margin:0 0 8px}
  #spark-dialog input[type=text],#spark-dialog textarea{width:100%;border:1px solid var(--rule);border-radius:0;background:var(--panel);color:var(--sp-ink);padding:12px;font:inherit;line-height:1.5}#spark-dialog textarea{min-height:96px;resize:vertical}
  #spark-dialog input[type=checkbox]{accent-color:var(--sp-green);width:20px;height:20px;flex-shrink:0}#spark-dialog .sp-check{display:flex;gap:10px;align-items:center;font-size:14px;margin:16px 0}
  #spark-dialog .sp-time{font-family:"Bricolage Grotesque",Arial,sans-serif;font-variant-numeric:tabular-nums;font-size:56px;font-weight:700;line-height:1.2;letter-spacing:-.04em;margin:20px 0 8px}#spark-dialog .sp-notice{border:1px solid var(--signal);background:var(--signal-w);padding:16px;border-radius:0;margin:16px 0}
  #spark-dialog .sp-foot{padding:16px 24px;border-top:1px solid var(--sp-line);font-size:13px;color:var(--sp-muted)}#spark-dialog details{margin:20px 0}#spark-dialog summary{cursor:pointer;padding:8px 0;font-weight:600}
  #spark-dialog .sp-return{width:100%;text-align:left;margin:6px 0!important;overflow-wrap:anywhere}#spark-dialog .sp-return span{display:block;font-size:14px;margin-top:4px}#spark-dialog table{width:100%;border-collapse:collapse;font-size:14px}#spark-dialog th,#spark-dialog td{text-align:left;padding:10px 6px;border-bottom:1px solid var(--sp-line)}
  #spark-launch{position:fixed;bottom:18px;right:18px;z-index:9998;background:var(--go);color:var(--panel);border:1px solid var(--go);border-radius:0;padding:13px 18px;box-shadow:0 3px 16px rgba(0,0,0,.22);font-family:"Hanken Grotesk","Helvetica Neue",Arial,sans-serif;font-size:15px;font-weight:600}
  #spark-home{width:100%;text-align:left;background:var(--panel);border:1px solid var(--rule);border-left:3px solid var(--go);padding:15px 16px;margin:0 0 20px;font:inherit;cursor:pointer;color:var(--ink)}#spark-home strong,#spark-home span{display:block}#spark-home span{font-size:13px;margin-top:3px;color:var(--dim)}
  @media(max-width:480px){#spark-dialog .sp-body{padding:20px 16px}#spark-dialog .sp-head,#spark-dialog .sp-foot{padding:14px 16px}#spark-dialog .sp-card{padding:16px}#spark-dialog .sp-row button{flex-grow:1}#spark-launch{bottom:12px;right:12px}}
  @media(prefers-reduced-motion:reduce){#spark-dialog *{scroll-behavior:auto!important}}
  `;
  document.head.append(style);
  const dialog=document.createElement('dialog');dialog.id='spark-dialog';dialog.setAttribute('aria-labelledby','spark-heading');document.body.append(dialog);
  const launch=document.createElement('button');launch.id='spark-launch';launch.type='button';launch.textContent='Find my spark';launch.addEventListener('click',open);document.body.append(launch);
  const home=document.getElementById('s-home');
  if(home){const entry=document.createElement('button');entry.id='spark-home';entry.type='button';entry.innerHTML='<strong>Find my spark</strong><span>Find something to do, or a more appealing way to do your own task.</span>';entry.addEventListener('click',open);home.prepend(entry);}
  function open(){lastFocus=document.activeElement;if(data.active)screen='session';render();if(!dialog.open)dialog.showModal();launch.hidden=true;}
  function close(){dialog.close();launch.hidden=false;lastFocus?.focus?.();}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  const button=(action,label,extra='')=>`<button type="button" data-sp="${action}" ${extra}>${label}</button>`;
  function flavor(cat,index,mode){
    const [title,description]=IDEAS[cat][index];
    const extras={easy:'',novel:cat==='sounds'?'Try a texture or mood you do not usually choose.': 'Change one familiar detail: the place, order, material, or soundtrack.',challenge:cat==='sounds'?'Give yourself one constraint: three beats maximum, or just two lines.': 'Set one small finish line you can see. Stop there if you want.',company:'If someone is available, try your own small activities alongside each other. If nobody is free, you can still try this on your own.'};
    return {title,description:`${description} ${extras[mode]}`.trim()};
  }
  let aiDraft='',aiBusy=false,aiError='',aiStatus='unknown',aiAbort=null;
  function aiView(){
    const local=location.protocol==='file:';
    return `<p class="sp-kicker">Personalized ideas</p><h1 id="spark-heading" tabindex="-1">Talk it through with Claude</h1><p class="sp-muted">Tell it what you want to do, what you liked, or what got boring. You can keep shaping the ideas together.</p>
    ${local?'<p class="sp-notice">You are viewing the downloaded file. Claude needs the server version. <a href="http://127.0.0.1:4173/">Open the local app</a>.</p>':aiStatus==='missing'?'<p class="sp-notice">Claude is not connected yet. The server needs an Anthropic API key. Built-in ideas still work.</p>':aiStatus==='unavailable'?'<p class="sp-notice">The Claude connection is unavailable on this version. Built-in ideas still work.</p>':''}
    <div aria-label="Conversation">${data.chat.map(m=>`<article class="sp-card"><p class="sp-kicker">${m.role==='user'?'You':'Claude'}</p><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(m.content)}</div></article>`).join('')}</div>
    ${aiBusy?'<p role="status">Claude is thinking of a direction…</p>':''}${aiError?`<p class="sp-notice" role="alert">${escape(aiError)}</p>`:''}
    <label class="sp-label" for="spark-ai-message">What would you like help with?</label><textarea id="spark-ai-message" maxlength="3000" ${aiBusy?'disabled':''} placeholder="I like shaping things and comparing them, but this project is getting repetitive. Help me find a different direction.">${escape(aiDraft)}</textarea>
    <p class="sp-small sp-muted">Send shares this message and recent messages in this conversation with Anthropic. Saved task and project notes are not included automatically. API use is billed to the connected account.</p>
    <div class="sp-row">${button('ai-send',aiBusy?'Getting a reply…':'Send to Claude',`class="sp-primary" ${aiBusy||local||aiStatus==='missing'?'disabled':''}`)}${aiBusy?button('ai-cancel','Cancel reply'):''}${button('projects','Browse built-in ideas')}${button('choose','Back')}</div><p class="sp-small sp-muted">Recent replies stay in this browser. Ideas can miss the mark; tell Claude what does not fit.</p>`;
  }
  async function openAI(prefill=''){
    if(prefill)aiDraft=prefill;screen='ai';notice='';render();
    if(location.protocol==='file:')return;
    try{const r=await fetch('/api/status',{signal:AbortSignal.timeout(5000)});const status=await r.json();aiStatus=r.ok&&status.configured?'ready':r.ok?'missing':'unavailable';}catch{aiStatus='unavailable';}
    if(screen==='ai')render(false);
  }
  async function sendAI(){
    if(aiBusy)return;
    const message=aiDraft.trim();if(!message){aiError='Write a few words first.';render(false);dialog.querySelector('#spark-ai-message')?.focus();return;}
    const history=data.chat.slice(-8);
    while(history.reduce((n,m)=>n+m.content.length,0)+message.length>30000)history.splice(0,2);
    const messages=[...history,{role:'user',content:message}];
    aiBusy=true;aiError='';aiAbort=new AbortController();const timeout=setTimeout(()=>aiAbort?.abort(),50000);render(false);
    try{
      const r=await fetch('/api/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages}),signal:aiAbort.signal});
      let result;try{result=await r.json();}catch{throw Error('This version does not have a working Claude connection yet. Your message has been kept.');}
      if(!r.ok)throw Error(result.error||'Claude could not reply. Your message has been kept.');
      if(typeof result.reply!=='string'||!result.reply.trim())throw Error('No reply came back. Your message has been kept.');
      data.chat=[...messages,{role:'assistant',content:result.reply.slice(0,7000)}].slice(-8);aiDraft='';save();
      if(result.truncated)aiError='The reply reached its length limit. You can ask Claude to continue.';
    }catch(error){aiError=error.name==='AbortError'?'The request stopped. Your message is still here.':error.message;}
    finally{clearTimeout(timeout);aiBusy=false;aiAbort=null;if(screen==='ai')render(false);}
  }

  function welcomeView(){
    return `<p class="sp-kicker">Follow what interests you</p><h1 id="spark-heading" tabindex="-1">What would help right now?</h1><p class="sp-muted">Find something with room to explore, keep an interest going, or make your own task more appealing.</p>
    <article class="sp-card"><h2>Ideas that respond to you</h2><p>Tell Claude what appeals to you and what does not. Shape a new direction together.</p>${button('ai','Talk it through with Claude','class="sp-primary"')}</article>
    <article class="sp-card"><h2>Find something to get into</h2><p>Build, compare, or investigate. Explore a project and change the direction when part of it gets boring.</p>${button('projects','Explore some directions','class="sp-primary"')}</article>
    <article class="sp-card"><h2>I have my own task</h2><p>Tell me what it is. Try a smaller, more interesting, or more social way into it.</p>${button('own','Make my task more appealing','class="sp-primary"')}</article>
    <div class="sp-row">${button('patterns','My discoveries & saved tasks')}</div><p class="sp-small sp-muted">We can try to make it more appealing. You do not have to love every task.</p>`;
  }
  function ownView(){
    const plan=ownReady?taskPlan(ownTask,ownReason,approach):null;
    return `<h1 id="spark-heading" tabindex="-1">A better way into your task</h1><label class="sp-label" for="spark-own-task">What do you want or need to do?</label><input type="text" id="spark-own-task" maxlength="160" value="${escape(ownTask)}" placeholder="Clean my room, read a chapter, reply to an email…">
    <label class="sp-label" for="spark-own-reason">What makes it unappealing?</label><select id="spark-own-reason" style="width:100%;padding:12px;font:inherit;background:var(--panel);color:var(--ink);border:1px solid var(--rule);border-radius:0">${Object.entries({boring:'It sounds boring',big:'It feels too big',unclear:'I do not know where to begin',flat:'I am not feeling it'}).map(([k,v])=>`<option value="${k}" ${ownReason===k?'selected':''}>${v}</option>`).join('')}</select>
    <p class="sp-label">Pick an approach</p><div class="sp-row">${Object.entries(APPROACHES).map(([k,v])=>button('own-approach',v,`data-value="${k}" aria-pressed="${approach===k}"`)).join('')}</div>
    <div class="sp-row">${button('own-ai','Ask Claude for ideas','class="sp-primary"')}${button('own-plan','Try a built-in suggestion')}</div>
    ${plan?`<article class="sp-card"><h2>${escape(plan.title)}</h2><p>${escape(plan.description)}</p>${button('own-start','Try this for 5 minutes','class="sp-primary"')}<p class="sp-small">Not appealing? Change the approach above and try another version.</p></article>`:''}
    <div class="sp-row">${button('choose','Back to the two choices')}</div>`;
  }
  function chooseView(){
    const notes=[...data.records].reverse().filter(r=>r.note||r.reference).slice(0,3);
    return `<p class="sp-kicker">A little curiosity is enough</p><h1 id="spark-heading" tabindex="-1">Find my spark</h1><p class="sp-muted">Pick an area, then choose one small thing to try. You can change the approach if the task itself does not appeal yet.</p>
    <div class="sp-row" aria-label="Choose an activity">${Object.entries(CATEGORIES).filter(([k])=>k!=='own').map(([k,v])=>button('category',v,`data-value="${k}" aria-pressed="${category===k}"`)).join('')}</div>
    <details><summary>Change how I try it</summary><div class="sp-row" aria-label="Choose an approach">${Object.entries(APPROACHES).map(([k,v])=>button('approach',v,`data-value="${k}" aria-pressed="${approach===k}"`)).join('')}</div></details>
    <p class="sp-kicker">${escape(APPROACHES[approach])} · Choose one experiment</p>
    ${IDEAS[category].map((_,i)=>{const p=flavor(category,i,approach);return `<article class="sp-card"><h2>${escape(p.title)}</h2><p>${escape(p.description)}</p>${button('start','Try this for 5 minutes',`data-index="${i}"`)}</article>`;}).join('')}
    ${notes.length?`<details><summary>My ways back in</summary>${notes.map(r=>button('resume',`<strong>${escape(r.title)}</strong><span>${escape(r.note||r.reference)}</span>`,`class="sp-return" data-id="${escape(r.id)}"`)).join('')}</details>`:''}
    <div class="sp-row">${button('own','Use my own task instead')}${button('patterns','What has caught my interest')}${button('choose','Back')}</div><p class="sp-small sp-muted">These are personal experiments, with no promise of triggering hyperfocus.</p>`;
  }
  function sessionView(){
    const a=data.active;
    if(!a){screen='choose';return chooseView();}
    const done=remaining(a.end)===0;
    return `<p class="sp-kicker">${escape(CATEGORIES[a.category])} · ${escape(APPROACHES[a.approach])}</p><h1 id="spark-heading" tabindex="-1">${escape(a.title)}</h1><p class="sp-muted">${escape(a.description)}</p>
    <div class="sp-time" id="spark-time" role="timer" aria-label="Time remaining">${formatTime(remaining(a.end))}</div><p id="spark-time-message" class="sp-muted" aria-live="polite">${done?'Five minutes is enough. Continue if you want, or leave it here.':'An invitation, not a deadline. Stop whenever you want.'}</p>
    <div class="sp-row">${button('extend','Give it 5 more minutes')}${button('close','Keep going in the background')}</div>
    <label class="sp-check"><input type="checkbox" id="spark-checkins" ${data.checkins?'checked':''}>Gentle check-in every 20 minutes during this experiment</label><p class="sp-small sp-muted">Check-ins appear here while the app is open. No sound or phone notifications.</p>
    <div id="spark-checkin" class="sp-notice" ${data.checkins&&Date.now()>=a.checkAt?'':'hidden'} role="status"><strong>A moment to check in</strong><p>Would water, food, or a stretch help? Do you still want to continue?</p>${button('check-dismiss','Checked in — continue')}</div>
    <label class="sp-label" for="spark-note">Leave a way back in (optional)</label><textarea id="spark-note" maxlength="600" placeholder="Next time: try two lines over that airy beat.">${escape(noteDraft)}</textarea>
    <label class="sp-label" for="spark-reference">Sound name or link (optional)</label><input id="spark-reference" type="text" maxlength="300" value="${escape(refDraft)}" placeholder="A beat title, saved link, or file name">
    <h2 style="margin-top:24px">How did it feel?</h2><p class="sp-small sp-muted">One tap saves this experiment and your way back in.</p><div class="sp-row">${Object.entries(RATINGS).map(([k,v])=>button('rate',v,`data-value="${k}"`)).join('')}</div>`;
  }
  function resultView(){
    const r=data.records.find(x=>x.id===currentRecord);
    if(!r){screen='choose';return chooseView();}
    return `<p class="sp-kicker">${storageOK?'Saved':'Kept for this visit'}</p><h1 id="spark-heading" tabindex="-1">${r.rating==='hooked'?'That caught something.':r.rating==='okay'?'Okay counts too.':'Useful to know.'}</h1><p class="sp-muted">${r.rating==='flat'?'You do not have to force it. You can try another idea or leave it for today.':'You can leave it here. It does not need to turn into a bigger project.'}</p><h2>Anything that helped?</h2><p class="sp-small sp-muted">Optional. Tap any that fit; each tap saves.</p><div class="sp-row">${HELPERS.map((h,i)=>button('helper',escape(h),`data-index="${i}" aria-pressed="${r.helpers.includes(h)}"`)).join('')}</div>
    <label class="sp-label" for="spark-note">My way back in</label><textarea id="spark-note" maxlength="600" placeholder="One thing to pick up next time">${escape(r.note)}</textarea><label class="sp-label" for="spark-reference">Sound name or link</label><input id="spark-reference" type="text" maxlength="300" value="${escape(r.reference)}" placeholder="A beat title, saved link, or file name"><p class="sp-small sp-muted">Edits save as you type.</p>
    <div class="sp-row">${button('choose','Find another spark','class="sp-primary"')}${button('patterns','See my discoveries')}${button('close','Done for now')}</div>`;
  }
  function patternsView(){
    const rows=summarize(data.records), notes=[...data.records].reverse().filter(r=>r.note||r.reference);
    const helpers=HELPERS.map(h=>({name:h,count:data.records.filter(r=>r.rating==='hooked'&&r.helpers.includes(h)).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    return `<h1 id="spark-heading" tabindex="-1">My discoveries</h1><p class="sp-muted">What you noticed, without a streak to maintain.</p>${rows.length?`<table><caption class="sp-small">Your saved experiments · ${data.records.length} total</caption><thead><tr><th scope="col">Activity</th><th scope="col">Tried</th><th scope="col">Got into it</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${escape(r.label)}</th><td>${r.total}</td><td>${r.hooked}</td></tr>`).join('')}</tbody></table><p class="sp-small sp-muted">These counts describe your entries, not what will work every time.</p>`:'<div class="sp-card"><h2>No experiments saved yet</h2><p>Try one idea and tap how it felt. Your discoveries will appear here.</p></div>'}
    ${helpers.length?`<h2 style="margin-top:24px">What you said helped</h2>${helpers.map(h=>`<p>${escape(h.name)} <span class="sp-muted">— on ${h.count} experiment${h.count===1?'':'s'} you got into</span></p>`).join('')}`:''}
    <h2 style="margin-top:24px">Ways back in</h2>${notes.length?notes.map(r=>button('resume',`<strong>${escape(r.title)}</strong><span>${escape(r.note)}</span>${r.reference?`<span>${escape(r.reference)}</span>`:''}`,`class="sp-return" data-id="${escape(r.id)}"`)).join(''):'<p class="sp-muted">Leave a note or sound name after an experiment to make returning easier.</p>'}<div class="sp-row">${button('choose','Find a spark','class="sp-primary"')}</div><p class="sp-small sp-muted">Keeps your latest 200 experiments on this device. Clearing browser data removes them.</p>`;
  }
  function render(focusHeading=true){
    const content=screen==='ai'?aiView():screen==='projects'?projectChooser():screen==='project'?projectView():screen==='welcome'?welcomeView():screen==='own'?ownView():screen==='session'?sessionView():screen==='result'?resultView():screen==='patterns'?patternsView():chooseView();
    dialog.innerHTML=`<header class="sp-head"><span class="sp-brand">COLD START / SPARK</span>${button('close','Close','class="sp-close" aria-label="Close Find my spark"')}</header><div class="sp-body">${notice?`<p class="sp-notice" role="status">${escape(notice)}</p>`:''}${content}</div><footer class="sp-foot" id="spark-storage">${storageOK?'Saved in this browser. Claude receives only the conversation you send.':'Browser saving is unavailable. Keep a copy of notes you want to retain.'}</footer>`;
    if(focusHeading){dialog.scrollTop=0;dialog.querySelector('h1')?.focus();}
  }
  function begin(p,cat=category,mode=approach){
    const now=Date.now();data.active={...p,category:cat,approach:mode,started:now,end:now+300000,checkAt:now+1200000,note:noteDraft,reference:refDraft};screen='session';notice='';save();render();
  }
  dialog.addEventListener('input',e=>{
    if(e.target.id==='spark-ai-message'){aiDraft=e.target.value;return;}
    if(e.target.id==='spark-project-note'){if(data.projects[projectId]){data.projects[projectId].note=e.target.value;save();}return;}
    if(e.target.id==='spark-own-task'){ownTask=e.target.value;ownReady=false;const start=dialog.querySelector('[data-sp="own-start"]');if(start)start.disabled=true;return;}
    if(!['spark-note','spark-reference'].includes(e.target.id))return;
    const field=e.target.id==='spark-note'?'note':'reference';
    if(field==='note')noteDraft=e.target.value;else refDraft=e.target.value;
    const target=screen==='result'?data.records.find(r=>r.id===currentRecord):data.active;
    if(target){target[field]=e.target.value;save();}
  });
  dialog.addEventListener('change',e=>{
    if(e.target.id==='spark-own-reason'){ownReason=e.target.value;ownReady=false;const start=dialog.querySelector('[data-sp="own-start"]');if(start)start.disabled=true;return;}
    if(e.target.id!=='spark-checkins')return;data.checkins=e.target.checked;if(data.active)data.active.checkAt=Date.now()+1200000;save();tick();
  });
  dialog.addEventListener('click',e=>{
    const el=e.target.closest('button[data-sp]');if(!el)return;const action=el.dataset.sp;
    if(action==='close'){close();return;}
    if(action==='ai'){openAI();return;}
    if(action==='ai-send'){sendAI();return;}
    if(action==='ai-cancel'){aiAbort?.abort();return;}
    if(action==='own-ai'){if(!ownTask.trim()){notice='Add your task first — a few words is enough.';render(false);dialog.querySelector('#spark-own-task')?.focus();return;}openAI('Help make this task more appealing: '+ownTask+'. What gets in the way: '+ownReason+'. Approach I want to explore: '+APPROACHES[approach]+'.');return;}
    if(action==='project-ai'&&PROJECTS[projectId]){const p=PROJECTS[projectId],st=data.projects[projectId];openAI('I am exploring: '+p.title+'. Current direction: '+(st.angle?p.twists[st.angle]:p.steps[st.step][1])+'. Help me make this more interesting, or find a better angle.');return;}
    if(action==='projects'){screen='projects';notice='';render();}
    if(action==='hook'){data.hook=el.dataset.value;save();render(false);dialog.querySelector('[data-sp="hook"][data-value="'+data.hook+'"]')?.focus();}
    if(action==='project-open'&&PROJECTS[el.dataset.id]){projectId=el.dataset.id;data.projects[projectId] ||= {step:0,angle:'',note:'',reactions:[]};showBored=false;screen='project';save();render();}
    if(action==='project-more'&&data.projects[projectId]){data.projects[projectId]=nextProjectState(data.projects[projectId],'more');showBored=false;save();render();}
    if(action==='project-bored'){showBored=!showBored;render(false);dialog.querySelector('[data-sp="project-bored"]')?.focus();}
    if(action==='project-angle'&&data.projects[projectId]){data.projects[projectId]=nextProjectState(data.projects[projectId],el.dataset.value);showBored=false;save();render();}
    if(action==='category'){category=el.dataset.value;render(false);dialog.querySelector(`[data-sp="category"][data-value="${category}"]`)?.focus();}
    if(action==='approach'){approach=el.dataset.value;render(false);const details=dialog.querySelector('details');if(details)details.open=true;dialog.querySelector(`[data-sp="approach"][data-value="${approach}"]`)?.focus();}
    if(action==='start'){noteDraft='';refDraft='';begin(flavor(category,Number(el.dataset.index),approach));}
    if(action==='extend'&&data.active){data.active.end=Date.now()+300000;save();tick();}
    if(action==='check-dismiss'&&data.active){data.active.checkAt=Date.now()+1200000;save();tick();}
    if(action==='rate'&&data.active){const a=data.active;const r=cleanRecord({...a,id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,at:Date.now(),rating:el.dataset.value,helpers:[],note:noteDraft,reference:refDraft});data.records.push(r);data.records=data.records.slice(-200);currentRecord=r.id;data.active=null;screen='result';save();render();}
    if(action==='helper'){const r=data.records.find(x=>x.id===currentRecord);if(r){const h=HELPERS[Number(el.dataset.index)];r.helpers=r.helpers.includes(h)?r.helpers.filter(x=>x!==h):[...r.helpers,h];save();el.setAttribute('aria-pressed',String(r.helpers.includes(h)));}}
    if(action==='choose'){screen='welcome';notice='';render();}
    if(action==='discover'){if(category==='own')category='everyday';screen='choose';notice='';render();}
    if(action==='own'){screen='own';notice='';render();}
    if(action==='own-approach'){approach=el.dataset.value;ownReady=!!ownTask.trim();render(false);dialog.querySelector(`[data-sp="own-approach"][data-value="${approach}"]`)?.focus();}
    if(action==='own-plan'){ownReady=!!ownTask.trim();notice=ownReady?'':'Add your task first — a few words is enough.';render(false);if(!ownReady)dialog.querySelector('#spark-own-task')?.focus();}
    if(action==='own-start'&&ownReady){const plan=taskPlan(ownTask,ownReason,approach);if(plan){noteDraft='';refDraft='';begin(plan,'own',approach);}}
    if(action==='patterns'){screen='patterns';notice='';render();}
    if(action==='resume'){const r=data.records.find(x=>x.id===el.dataset.id);if(r){noteDraft=r.note;refDraft=r.reference;category=r.category;approach=r.approach;begin({title:r.title,description:r.note||'Return to the sound or idea you saved.'},r.category,r.approach);}}
  });
  function tick(){
    const a=data.active;
    launch.textContent=a?`My spark · ${remaining(a.end)?formatTime(remaining(a.end)):'Check in'}`:'Find my spark';
    if(!a||screen!=='session')return;
    const time=dialog.querySelector('#spark-time');if(time)time.textContent=formatTime(remaining(a.end));
    const msg=dialog.querySelector('#spark-time-message');const text=remaining(a.end)?'An invitation, not a deadline. Stop whenever you want.':'Five minutes is enough. Continue if you want, or leave it here.';if(msg&&msg.textContent!==text)msg.textContent=text;
    const check=dialog.querySelector('#spark-checkin');if(check)check.hidden=!(data.checkins&&Date.now()>=a.checkAt);
  }
  if(data.active){noteDraft=String(data.active.note||'').slice(0,600);refDraft=String(data.active.reference||'').slice(0,300);}
  // Timers use wall-clock deadlines so background-tab throttling does not stretch them.
  setInterval(tick,1000);document.addEventListener('visibilitychange',tick);tick();
  if(document.body.hasAttribute('data-spark-standalone'))open();
})();
