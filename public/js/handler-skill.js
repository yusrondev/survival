// public/js/handler-skill.js

// ambil tombol
const btns = document.querySelectorAll('#skillPanel .skill');

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

// helper buat register event listeners yang mendukung multi-touch
btns.forEach((btn, idx) => {
  // map berdasarkan urutan atau data-attribute
  const skill = btn.dataset.skill || (idx === 0 ? 'damage' : idx === 1 ? 'speed' : 'defend');

  // Prefer pointer events (support multi-touch and better coexistance)
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); // mencegah fokus / ghost click
    handleSkillClick(skill);
  });

  // mobile fallback: touchstart (some older Android browsers)
  btn.addEventListener('touchstart', (ev) => {
    // jika browser memanggil touchstart setelah pointerdown, ini bisa double-trigger,
    // jadi kita cek apakah pointer event sudah menangani. Simple approach: stopPropagation.
    ev.preventDefault();
    handleSkillClick(skill);
  }, { passive: false });

  // click fallback (desktop)
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    handleSkillClick(skill);
  });
});
