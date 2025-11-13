document.querySelectorAll('.skill').forEach(btn => {
  btn.addEventListener('click', () => {
    const skill = btn.textContent.toLowerCase().split(' ')[0]; // "damage" "speed" "defend"
    window.useSkill(skill);
  });
});
