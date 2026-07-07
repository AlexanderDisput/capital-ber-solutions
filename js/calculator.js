/**
 * BER Savings & Grant Calculator
 * Baseline figures are median SEAI grant amounts and market cost/energy
 * data (see BER calculator.pdf) — illustrative estimates, not quotes.
 */
(function () {
  var GRADES = ['G', 'F', 'E', 'D', 'C', 'B', 'A'];

  var BILL_BY_GRADE = {
    G: 4500,
    F: 3500,
    E: 3500,
    D: 2500,
    C: 1600,
    B: 950,
    A: 500
  };

  var DEEP_RETROFIT = {
    apartment: { label: 'Apartment', gross: 30345, grant: 11300, net: 19045 },
    'mid-terrace': { label: 'Mid-Terrace', gross: 55250, grant: 18813, net: 36437 },
    'semi-detached': { label: 'Semi-Detached', gross: 60805, grant: 21700, net: 39105 },
    detached: { label: 'Detached', gross: 69795, grant: 24500, net: 45295 }
  };

  var UPGRADES = [
    { id: 'attic', label: 'Attic Insulation', gradeMin: 1, gradeMax: 2, costMin: 1500, costMax: 3500, grant: 2000 },
    { id: 'cavity', label: 'Cavity Wall Insulation', gradeMin: 1, gradeMax: 2, costMin: 1500, costMax: 3000, grant: 1800 },
    { id: 'heating-controls', label: 'Heating Controls', gradeMin: 0.5, gradeMax: 1, costMin: 800, costMax: 2000, grant: 700 },
    { id: 'solar', label: 'Solar PV Panels (4kWp)', gradeMin: 1, gradeMax: 2, costMin: 5000, costMax: 10000, grant: 1800 },
    { id: 'heat-pump', label: 'Heat Pump System', gradeMin: 2, gradeMax: 4, costMin: 12000, costMax: 18000, grant: 12500 },
    { id: 'external-wall', label: 'External Wall Insulation', gradeMin: 2, gradeMax: 3, costMin: 12000, costMax: 24000, grant: 8000 }
  ];

  function formatEUR(amount) {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function pushEvent(eventName, extra) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: eventName }, extra || {}));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('ber-calculator-form');
    if (!form) return;

    var routeRadios = form.querySelectorAll('input[name="calc-route"]');
    var individualSection = document.getElementById('calc-individual-measures');
    var deepNote = document.getElementById('calc-deep-note');
    var measureError = document.getElementById('calc-measure-error');
    var resultsPanel = document.getElementById('calc-results');

    function currentRoute() {
      var checked = form.querySelector('input[name="calc-route"]:checked');
      return checked ? checked.value : 'deep';
    }

    function toggleRouteSections() {
      var route = currentRoute();
      individualSection.hidden = route !== 'individual';
    }

    routeRadios.forEach(function (radio) {
      radio.addEventListener('change', toggleRouteSections);
    });
    toggleRouteSections();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      measureError.hidden = true;
      deepNote.hidden = true;

      var currentGrade = document.getElementById('calc-current-rating').value;
      var propertyType = document.getElementById('calc-property-type').value;
      var propertyValueRaw = document.getElementById('calc-property-value').value;
      var propertyValue = propertyValueRaw ? parseFloat(propertyValueRaw) : 0;
      var route = currentRoute();

      if (!currentGrade || !propertyType) return;

      var currentIndex = GRADES.indexOf(currentGrade);
      var grossCost, grantAmount, netCost, projectedIndex;

      if (route === 'deep') {
        var deep = DEEP_RETROFIT[propertyType];
        var targetIndex = GRADES.indexOf('B');

        if (currentIndex >= targetIndex) {
          deepNote.hidden = false;
          resultsPanel.hidden = true;
          return;
        }

        grossCost = deep.gross;
        grantAmount = deep.grant;
        netCost = deep.net;
        projectedIndex = targetIndex;
      } else {
        var checkedMeasures = Array.prototype.slice.call(
          form.querySelectorAll('input[name="calc-measure"]:checked')
        );

        if (checkedMeasures.length === 0) {
          measureError.hidden = false;
          resultsPanel.hidden = true;
          return;
        }

        grossCost = 0;
        grantAmount = 0;
        var totalGradeImprovement = 0;

        checkedMeasures.forEach(function (input) {
          var upgrade = UPGRADES.filter(function (u) { return u.id === input.value; })[0];
          if (!upgrade) return;
          grossCost += (upgrade.costMin + upgrade.costMax) / 2;
          grantAmount += upgrade.grant;
          totalGradeImprovement += (upgrade.gradeMin + upgrade.gradeMax) / 2;
        });

        grantAmount = Math.min(grantAmount, grossCost);
        netCost = grossCost - grantAmount;
        projectedIndex = Math.min(GRADES.length - 1, currentIndex + Math.round(totalGradeImprovement));
      }

      var projectedGrade = GRADES[projectedIndex];
      var currentBill = BILL_BY_GRADE[currentGrade];
      var projectedBill = BILL_BY_GRADE[projectedGrade];
      var annualSavings = currentBill - projectedBill;
      var gradesImproved = projectedIndex - currentIndex;

      document.getElementById('result-current-bill').textContent = formatEUR(currentBill) + ' / yr';
      document.getElementById('result-projected-grade').textContent = projectedGrade + ' rating';
      document.getElementById('result-projected-bill').textContent = formatEUR(projectedBill) + ' / yr';
      document.getElementById('result-annual-savings').textContent = formatEUR(annualSavings) + ' / yr';
      document.getElementById('result-gross-cost').textContent = formatEUR(grossCost);
      document.getElementById('result-grant').textContent = formatEUR(grantAmount);
      document.getElementById('result-net-cost').textContent = formatEUR(netCost);

      var paybackEl = document.getElementById('result-payback');
      if (annualSavings > 0 && netCost > 0) {
        paybackEl.textContent = (netCost / annualSavings).toFixed(1) + ' years';
      } else if (netCost <= 0) {
        paybackEl.textContent = 'Immediate';
      } else {
        paybackEl.textContent = 'N/A';
      }

      var equityTile = document.getElementById('result-equity-tile');
      if (propertyValue > 0 && gradesImproved > 0) {
        var lowUplift = propertyValue * 0.02 * gradesImproved;
        var highUplift = propertyValue * 0.03 * gradesImproved;
        document.getElementById('result-equity').textContent =
          formatEUR(lowUplift) + ' – ' + formatEUR(highUplift);
        equityTile.hidden = false;
      } else {
        equityTile.hidden = true;
      }

      resultsPanel.hidden = false;
      resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

      pushEvent('calculator_submit', {
        route: route,
        current_grade: currentGrade,
        projected_grade: projectedGrade,
        property_type: propertyType
      });
    });
  });
})();
