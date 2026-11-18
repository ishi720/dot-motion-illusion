/**
 * @file Dot Motion Illusion
 * 2色のドットを斜めの列に並べて上下に動かし、動きの錯視を描画する。
 * 設定パネルの値は data-key 属性を通じて state に反映される。
 */
(() => {
    'use strict';

    /**
     * 錯視の設定値。キー名は入力要素の data-key 属性と対応する。
     * @typedef {Object} Settings
     * @property {number} speed   ドットが動く速さ(px/秒)
     * @property {number} size    ドットの半径(px)
     * @property {number} gapx    隣り合う縦列どうしの横の間隔(px)
     * @property {number} gapy    隣り合う縦列どうしの縦のずれ(px)。斜め列の傾きを決める
     * @property {number} line    斜め列どうしの垂直距離(px)
     * @property {string} colorA  偶数列のドットの色
     * @property {string} colorB  奇数列のドットの色
     * @property {string} colorBg 背景色
     */

    /**
     * 設定の初期値。「初期値に戻す」でもこの値を使う。
     * @type {Readonly<Settings>}
     */
    const DEFAULTS = {
        speed: 80,
        size: 7.5,
        gapx: 6,
        gapy: 22.5,
        line: 31.5,
        colorA: '#78a8c5',
        colorB: '#ffffff',
        colorBg: '#000000',
    };

    /**
     * 現在の設定値。
     * @type {Settings}
     */
    const state = { ...DEFAULTS };

    /**
     * アニメーションを一時停止中かどうか。
     * @type {boolean}
     */
    let paused = false;

    /** @type {HTMLCanvasElement} */
    const canvas = document.getElementById('canvas');
    /** @type {CanvasRenderingContext2D} */
    const ctx = canvas.getContext('2d');
    /** 動きを減らす設定のときに表示する案内文。 */
    const stageNote = document.getElementById('stage-note');
    /** 操作結果を一時的に表示する領域(スクリーンリーダーにも読み上げられる)。 */
    const statusEl = document.getElementById('status');
    const btnPause = document.getElementById('btn-pause');
    const btnReset = document.getElementById('btn-reset');
    /**
     * data-key 属性を持つ設定用の入力要素。
     * @type {HTMLInputElement[]}
     */
    const inputs = [...document.querySelectorAll('[data-key]')];

    /* ---------- 設定の反映 ---------- */

    /**
     * 数値を小数第1位までに丸めて表示用の文字列にする。
     * @param {number} v 表示する数値
     * @returns {string} 丸めた値の文字列
     */
    function formatValue(v) {
        return String(Math.round(v * 10) / 10);
    }

    /**
     * 設定値を state に反映し、対応する入力要素と表示も更新する。
     * 値の型は DEFAULTS の同じキーの型に合わせて変換する。
     * @param {keyof Settings} key 設定のキー
     * @param {number|string} value 新しい値
     * @returns {void}
     */
    function apply(key, value) {
        state[key] = typeof DEFAULTS[key] === 'number' ? Number(value) : String(value);
        const input = inputs.find((el) => el.dataset.key === key);
        if (input) input.value = state[key];
        const out = document.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = formatValue(state[key]);
    }

    /* ---------- 操作 ---------- */

    /**
     * ステータス欄にメッセージを表示し、2.5秒後に消す。
     * 続けて呼ばれた場合は前のタイマーを取り消して表示し直す。
     * @param {string} message 表示するメッセージ
     * @returns {void}
     */
    function say(message) {
        statusEl.textContent = message;
        clearTimeout(say.t);
        say.t = setTimeout(() => { statusEl.textContent = ''; }, 2500);
    }

    /**
     * 一時停止の状態を切り替え、ボタンの表示と aria-pressed を更新する。
     * 再生に切り替えたときは、動きを減らす設定の案内を隠す。
     * @param {boolean} value true で一時停止、false で再生
     * @returns {void}
     */
    function setPaused(value) {
        paused = value;
        btnPause.textContent = paused ? '再生' : '一時停止';
        btnPause.setAttribute('aria-pressed', String(paused));
        if (!paused) stageNote.hidden = true;
    }

    inputs.forEach((el) => {
        el.addEventListener('input', () => {
            apply(el.dataset.key, el.value);
        });
    });

    btnPause.addEventListener('click', () => setPaused(!paused));

    btnReset.addEventListener('click', () => {
        for (const key of Object.keys(DEFAULTS)) apply(key, DEFAULTS[key]);
        say('初期値に戻しました');
    });

    // フォーカスがどこにもないときだけ、スペースキーで再生/一時停止を切り替える
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            setPaused(!paused);
        }
    });

    /* ---------- 描画 ---------- */

    /** canvas の表示幅(CSSピクセル)。 */
    let width = 0;
    /** canvas の表示高さ(CSSピクセル)。 */
    let height = 0;

    /**
     * canvas の描画解像度を表示サイズと devicePixelRatio に合わせる。
     * 以降の描画は CSSピクセル単位で行えるよう変換行列を設定する。
     * @returns {void}
     */
    function resize() {
        const rect = canvas.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas);

    /** ドット全体の縦方向の移動量(px)。 */
    let offsetY = 0;
    /** 前回フレームの時刻(ミリ秒)。 */
    let lastTime = performance.now();

    /**
     * 1フレーム分を描画し、次のフレームを予約する。
     * 一時停止中も、設定の変更を反映するために描画は続ける。
     * @param {DOMHighResTimeStamp} now requestAnimationFrame から渡される現在時刻(ミリ秒)
     * @returns {void}
     */
    function draw(now) {
        // タブが非表示だった後などに大きく飛ばないよう、経過時間は0.1秒までに抑える
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        if (!paused) offsetY += state.speed * dt;

        const w = width;
        const h = height;
        const gapX = state.gapx;
        const gapY = state.gapy;
        const radius = state.size;

        ctx.fillStyle = state.colorBg;
        ctx.fillRect(0, 0, w, h);

        // 斜め列どうしの垂直距離が常に「列どうしの間隔」になるよう、縦のずれを計算する
        const lineSpacingY = state.line * Math.hypot(gapX, gapY) / gapX;
        const pad = radius + 2;
        const off = offsetY % lineSpacingY;
        const iMax = Math.ceil((w / 2 + pad) / gapX) + 1;

        for (let i = -iMax; i <= iMax; i++) {
            const x = w / 2 + i * gapX;
            if (x < -pad || x > w + pad) continue;
            const base = -i * gapY + off;
            // この列で画面内に入る k の範囲だけを描く(間隔を変えても全面に出る)
            const kMin = Math.ceil((-pad - base) / lineSpacingY);
            const kMax = Math.floor((h + pad - base) / lineSpacingY);
            ctx.fillStyle = (((i % 2) + 2) % 2 === 0) ? state.colorA : state.colorB;
            for (let k = kMin; k <= kMax; k++) {
                ctx.beginPath();
                ctx.arc(x, k * lineSpacingY + base, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        requestAnimationFrame(draw);
    }

    /* ---------- 起動 ---------- */

    for (const key of Object.keys(DEFAULTS)) apply(key, DEFAULTS[key]);

    // OSで動きを減らす設定がされていれば、停止した状態で始めて案内を出す
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setPaused(true);
        stageNote.hidden = false;
    }

    requestAnimationFrame(draw);
})();
