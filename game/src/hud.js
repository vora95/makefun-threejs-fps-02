// The DOM HUD: crosshair, hit marker, health, armour, ammo, money, timer, score,
// killfeed, minimap, buy menu, banners and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Every setter
// skips work when the value did not change, so the HUD costs nothing at rest.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A foundry yard, two teams, one Spark Charge. Plant it at Furnace Hall or Crane Yard — or stop the other team from doing it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  next: {
    title: 'Next round',
    copy: '',
    action: 'Click to play',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const healthValue = $('health-value');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreV = $('score-vanguard');
  const scoreS = $('score-sentinel');
  const roundValue = $('round-value');
  const weaponName = $('weapon-name');
  const grenadeSlots = $('grenades');
  const killfeed = $('killfeed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const teamList = $('team-list');
  const bombStatus = $('bomb-status');
  const hint = $('hint');
  const minimap = $('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;

  let last = {};
  let hitTimer = 0;
  let buyItems = [];
  let onBuyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  buyList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-buy]');
    if (!button || !onBuyHandler) return;
    onBuyHandler(Number(button.dataset.buy));
  });

  return {
    setHealth(value, armor) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(value))));
      setText(armorValue, 'armor', String(Math.max(0, Math.ceil(armor))));
      healthValue.parentElement.classList.toggle('low', value <= 30);
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('urgent', seconds <= 10);
    },
    setScore(vanguard, sentinel) {
      setText(scoreV, 'sv', String(vanguard));
      setText(scoreS, 'ss', String(sentinel));
    },
    setRound(round, maxRounds) {
      setText(roundValue, 'round', `Round ${round} / ${maxRounds}`);
    },
    setWeapon(name) {
      setText(weaponName, 'weapon', name);
    },
    setGrenades(frag, smoke, selected) {
      const text = `Frag ${frag} · Smoke ${smoke}${selected ? ` — [${selected}]` : ''}`;
      setText(grenadeSlots, 'grenades', text);
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageFlash.classList.remove('on');
      void damageFlash.offsetWidth;
      damageFlash.classList.add('on');
    },
    killfeed(killer, victim, cause, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const killerSpan = document.createElement('b');
      killerSpan.textContent = killer;
      killerSpan.className = killer === 'You' ? 'me' : 'foe';
      const victimSpan = document.createElement('b');
      victimSpan.textContent = victim;
      victimSpan.className = victim === 'You' ? 'me' : 'foe';
      line.append(killerSpan, document.createTextNode(` ${cause} `), victimSpan);
      if (headshot) {
        const tag = document.createElement('span');
        tag.className = 'headshot';
        tag.textContent = ' HEADSHOT';
        line.append(tag);
      }
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(titleText, subText) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuyMenu(items, money, ownedWeapons, grenadeCounts) {
      buyItems = items;
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      items.forEach((item, index) => {
        const owned = item.kind === 'weapon' ? ownedWeapons.has(item.id)
          : item.kind === 'grenade' ? grenadeCounts[item.id] >= (item.id === 'frag' ? 2 : 1)
          : false;
        const afford = money >= item.price;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.buy = String(index);
        row.disabled = owned || !afford;
        row.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name"></span><span class="buy-desc"></span><span class="buy-price"></span>`;
        row.querySelector('.buy-name').textContent = item.name;
        row.querySelector('.buy-desc').textContent = owned ? 'Owned' : item.desc;
        row.querySelector('.buy-price').textContent = owned ? '—' : `$${item.price}`;
        buyList.appendChild(row);
      });
      buyMenu.hidden = false;
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
      buyItems = [];
    },
    buyMenuOpen() {
      return !buyMenu.hidden;
    },
    onBuy(handler) {
      onBuyHandler = handler;
    },
    setBombStatus(text, urgent) {
      setText(bombStatus, 'bomb', text);
      bombStatus.classList.toggle('urgent', !!urgent);
      bombStatus.hidden = !text;
    },
    setHint(text) {
      setText(hint, 'hint', text);
      hint.hidden = !text;
    },
    setTeamList(agents) {
      const text = agents.map((a) => `${a.alive ? '●' : '○'} ${a.name} ${a.alive ? Math.ceil(a.health) : 'dead'}`).join('  ');
      setText(teamList, 'team', text);
    },
    // Top-down map: walls, sites, the charge, teammates always, enemies only
    // while they were seen recently. North is up. bomb is the bomb module object.
    drawMinimap(map, agents, player, seenEnemies, bomb) {
      if (!mapCtx) return;
      const W = minimap.width;
      const H = minimap.height;
      const sx = W / 42;
      const sz = H / 34;
      const px = (x) => (x + 21) * sx;
      const pz = (z) => (z + 17) * sz;
      mapCtx.clearRect(0, 0, W, H);
      mapCtx.fillStyle = '#241c16';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.fillStyle = '#453729';
      for (const box of map.colliders) {
        if (box.max.y < 0.5) continue;
        mapCtx.fillRect(px(box.min.x), pz(box.min.z), (box.max.x - box.min.x) * sx, (box.max.z - box.min.z) * sz);
      }
      for (const key of Object.keys(map.sites)) {
        const site = map.sites[key];
        mapCtx.strokeStyle = '#ff8c1a';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.arc(px(site.center.x), pz(site.center.z), site.radius * sx, 0, Math.PI * 2);
        mapCtx.stroke();
        mapCtx.fillStyle = '#ff8c1a';
        mapCtx.font = 'bold 11px system-ui';
        mapCtx.fillText(key, px(site.center.x) - 4, pz(site.center.z) + 4);
      }
      if (bomb.state.status === 'planted' || bomb.state.status === 'dropped') {
        const pos = bomb.state.status === 'planted' ? bomb.state.plantAt : bomb.mesh.position;
        mapCtx.fillStyle = '#ff3b00';
        mapCtx.beginPath();
        mapCtx.arc(px(pos.x), pz(pos.z), 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const agent of agents) {
        if (!agent.alive) continue;
        const isPlayer = agent === player;
        const seen = isPlayer || agent.team === player.team || seenEnemies.has(agent);
        if (!seen) continue;
        mapCtx.fillStyle = isPlayer ? '#f2e8d5' : agent.team === 'vanguard' ? '#35c4b5' : '#e5484d';
        mapCtx.beginPath();
        mapCtx.arc(px(agent.body.position.x), pz(agent.body.position.z), isPlayer ? 4 : 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // Player facing tick.
      const p = player.body;
      mapCtx.strokeStyle = '#f2e8d5';
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.moveTo(px(p.position.x), pz(p.position.z));
      mapCtx.lineTo(px(p.position.x - Math.sin(p.yaw) * 2.4), pz(p.position.z - Math.cos(p.yaw) * 2.4));
      mapCtx.stroke();
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = mode === 'next' ? `Round ${detail}` : text.title;
      copy.textContent = mode === 'next' ? 'Freeze time. Press B to buy, then click to play.'
        : mode === 'roundEnd' || mode === 'matchEnd' ? detail || text.copy : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
