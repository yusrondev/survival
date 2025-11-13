// public/js/handler-skill.js

// ambil tombol
const btns = document.querySelectorAll('#skillPanel .skill');
const ENERGY_COST = {
  speed: 20,   // contoh: butuh 30 energy
  damage: 20,
  defend: 10
};

function handleSkillClick(skillName) {
  window.useSkill(skillName);

  // efek lokal sementara (client prediction)
  if (skillName === 'speed') {
    // double speed selama 3 detik
    window.tempSpeedBuff?.(); // matikan buff sebelumnya kalau masih aktif

    const oldSpeed = window.MAX_SPEED || 150;
    window.MAX_SPEED = oldSpeed * 2;
    window.SPEED_UP = true;

    const timeout = setTimeout(() => {
      window.MAX_SPEED = oldSpeed;
      window.SPEED_UP = false;
    }, 3000);

    window.tempSpeedBuff = () => {
      clearTimeout(timeout);
      window.MAX_SPEED = oldSpeed;
    };
  }
}

btns.forEach((btn, idx) => {
  const skill = btn.dataset.skill || (idx === 0 ? 'damage' : idx === 1 ? 'speed' : 'defend');

  const COOLDOWNS = {
    speed: 5,
    damage: 3,
    defend: 4
  };

  let isCoolingDown = false;

  function startCooldown(button, skillName) {
    const duration = COOLDOWNS[skillName] || 3;
    button.disabled = true;
    button.classList.add('cooldown');

    let remaining = duration;
    const originalText = button.innerText;
    button.innerText = `${originalText} (${remaining})`;

    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        button.innerText = `${originalText} (${remaining})`;
      } else {
        clearInterval(interval);
        button.disabled = false;
        button.innerText = originalText;
      }
    }, 1000);
  }

  function handleClickWrapper(ev) {
    ev.preventDefault();
    if (isCoolingDown || btn.disabled) return;

    const cost = ENERGY_COST[skill] || 0;
    if (!me || me.energy >= cost) {
      // kurangi energi client-side (prediction)
      me.energy = Math.max(0, me.energy - cost);
      updateHUD();

      handleSkillClick(skill);

      // aktifkan cooldown
      isCoolingDown = true;
      startCooldown(btn, skill);
      setTimeout(() => {
        isCoolingDown = false;
      }, (COOLDOWNS[skill] || 3) * 1000);
    }
  }

  btn.addEventListener('pointerdown', handleClickWrapper);
  btn.addEventListener('touchstart', handleClickWrapper, { passive: false });
  btn.addEventListener('click', handleClickWrapper);
});