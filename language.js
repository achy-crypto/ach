/* Optional, narrowly scoped wording/readability updates for the original Cold Start UI. */
(() => {
  const wording=new Map([
    ['PAST RUNWAY','EXTRA TIME'],['PARKED','SAVED THOUGHTS'],['PARKING LOT','SAVED THOUGHTS'],['THE RECORD','PAST SESSIONS'],
    ['Name it, shrink it, go.','Choose a small place to start.'],
    ['Three fields. No planning. The clock starts the second you hit the button.','Choose a first step and a time that works for you. The timer starts when you are ready.'],
    ['You know exactly what to do. You are not doing it. It’s been a while.','You have something to do and would like help getting started.'],
    ["You know exactly what to do. You are not doing it. It's been a while.",'You have something to do and would like help getting started.'],
    ['It keeps re-firing because nothing outside your skull is holding it. Type it badly. Nobody reads this.','Try putting the thought into words. It does not need to be tidy or complete.'],
    ['This is the only fork that matters. A problem gets an action. A worry gets an appointment. Neither one gets to stay in your head.','Would a small action help, or would you rather set this aside for later? It is okay if the thought comes back.'],
    ['4 — HOW LONG YOU OWE IT','4 — HOW LONG YOU WANT TO TRY'],
    ['BEFORE YOU GO — CLOSE THE EXITS','OPTIONAL — MAKE YOUR SPACE EASIER'],
    ['Twelve is the default because it’s short enough that starting doesn’t need a decision.','Twelve minutes is a starting option. Choose a different length if it suits you better.'],
    ["Twelve is the default because it's short enough that starting doesn't need a decision.",'Twelve minutes is a starting option. Choose a different length if it suits you better.']
  ]);
  function update(root){
    const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walk.nextNode())){
      if(node.parentElement?.closest('script,style,textarea,input,#spark-dialog'))continue;
      const replacement=wording.get(node.nodeValue.trim());if(replacement)node.nodeValue=replacement;
    }
  }
  update(document.body);
  new MutationObserver(changes=>{for(const change of changes)for(const node of change.addedNodes){if(node.nodeType===1)update(node);else if(node.nodeType===3&&!node.parentElement?.closest('script,style,textarea,#spark-dialog')){const text=wording.get(node.nodeValue.trim());if(text)node.nodeValue=text;}}}).observe(document.body,{subtree:true,childList:true});
  const style=document.createElement('style');style.textContent='[id^="s-"] p,[id^="s-"] input,[id^="s-"] textarea{font-size:max(1rem,16px)}[id^="s-"] label,[id^="s-"] .sub,[id^="s-"] .hint{font-size:max(.875rem,14px);color:#46534e}';document.head.append(style);
})();
