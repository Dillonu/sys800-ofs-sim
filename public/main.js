function submit(url, msg, callback) {
    let xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
        if (this.readyState !== 4) return;

        if (this.status === 200) {
            const data = JSON.parse(this.responseText);

            document.getElementById('r').innerText = JSON.stringify(data, null, '\t');
            if (callback) callback();
            // we get the returned data
        }

        // end of state change: it can be after some time (async)
    };
    xhr.send(JSON.stringify(msg));
}

function submitSim() {
    submit('/api/simulate', {
        count: Number(document.getElementById('c').value),
        configuration: {
            federateIds: [Number(document.getElementById('f1').value), Number(document.getElementById('f2').value)],
            turns: Number(document.getElementById('t').value),
            oAlg: document.getElementById('o').value,
            fAlg: document.getElementById('f').value
        }
    });
}

function submitTestSim() {
    const count = Number(document.getElementById('c').value);
    const turns = Number(document.getElementById('t').value);
    const oAlg = document.getElementById('o').value;
    const fAlg = document.getElementById('f').value;

    function upper() {
        let t = 0;

        function _upper() {
            if (t < turns) {
                submit('/api/simulate', {
                    count: count,
                    configuration: {
                        federateIds: [0, 0],
                        locations: [[3, 0], [2, 2]],
                        turns: t,
                        oAlg: oAlg,
                        fAlg: fAlg
                    }
                }, _upper);

                t += 1;
            }
        }

        _upper();
    }

    upper();
}

function queryStats() {
    submit('/api/statistics', {
        min: document.getElementById('min').checked,
        max: document.getElementById('max').checked,
        avg: document.getElementById('avg').checked,
        stdDev: document.getElementById('stdDev').checked,
        configuration: {
            federateIds: [Number(document.getElementById('f1').value), Number(document.getElementById('f2').value)],
            turns: Number(document.getElementById('t').value),
            oAlg: document.getElementById('o').value,
            fAlg: document.getElementById('f').value
        }
    });
}

function runAllSims(ids) {
    const count = Number(document.getElementById('c').value);
    const turns = Number(document.getElementById('t').value);
    const oAlg = document.getElementById('o').value;
    const fAlg = document.getElementById('f').value;

    function lower(i, callback) {
        let j = i;

        function _lower() {
            if (j < ids) {
                submit('/api/simulate', {
                    count: count,
                    config: {
                        federateIds: [i, j],
                        turns: turns,
                        oAlg: oAlg,
                        fAlg: fAlg
                    }
                }, _lower);

                j += 1;
            } else {
                callback();
            }
        }

        _lower();
    }

    function upper(callback) {
        let i = 0;

        function _upper() {
            if (i < ids) {
                lower(i, _upper);

                i += 1;
            } else {
                callback();
            }
        }

        _upper();
    }

    // Disable all buttons:
    document.querySelectorAll('input').forEach((el) => {
        el.disabled = true;
    });
    // Run query:
    upper(function () {
        // Enable all buttons:
        document.querySelectorAll('input').forEach((el) => {
            el.disabled = false;
        });
    });
}
