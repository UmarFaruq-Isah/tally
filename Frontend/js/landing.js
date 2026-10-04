(function () {
  document.getElementById('start-guest').addEventListener('click', function () { Tally.Auth.continueAsGuest(); });
  var list = document.getElementById('demo-list'), count = document.getElementById('demo-count');
  function sync() {
    var boxes = list.querySelectorAll('input'), done = 0;
    boxes.forEach(function (b) { b.closest('li').classList.toggle('done', b.checked); if (b.checked) done++; });
    count.textContent = done + ' of ' + boxes.length + ' done';
  }
  list.addEventListener('change', sync); sync();
})();
