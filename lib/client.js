window.__ModuleLoader__.load({
	id: "dsh-workbuddy-connect",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/status-paths.ts
		/** Node-free constants and types shared by the Host and browser halves. */
		/**
		* How long a benched account stays benched, in the unit that reads best.
		*
		* Shared rather than written on each side because both halves describe the same
		* field of the same document, and the CLI and the settings page disagreeing
		* about how long a cooldown has left would read as one of them being wrong. The
		* *wording* stays local, because only each side knows its language.
		*
		* The hour unit exists because an upstream-stated reset can be most of a day
		* away, and "1078 分钟" is a number nobody converts in their head.
		*/
		function describeWait(untilMs, now) {
			const minutes = Math.max(1, Math.ceil(Math.max(0, untilMs - now) / 6e4));
			return minutes < 60 ? {
				unit: "minute",
				value: minutes
			} : {
				unit: "hour",
				value: Math.ceil(minutes / 60)
			};
		}
		/** Both products, in display order. */
		const CARD_VARIANTS = [{
			id: "workbuddy",
			titleKey: "title",
			introKey: "intro",
			signedOutKey: "signedOutHint",
			statusPath: "/plugins/dsh-workbuddy-connect/status",
			probePath: "/plugins/dsh-workbuddy-connect/probe",
			accountPath: "/plugins/dsh-workbuddy-connect/accounts",
			appName: "WorkBuddy",
			unavailableKey: "assistUnavailableCN"
		}, {
			id: "workbuddy-ai",
			titleKey: "titleAI",
			introKey: "introAI",
			signedOutKey: "signedOutHintAI",
			statusPath: "/plugins/dsh-workbuddy-connect/ai/status",
			probePath: "/plugins/dsh-workbuddy-connect/ai/probe",
			accountPath: "/plugins/dsh-workbuddy-connect/ai/accounts",
			appName: "WorkBuddy AI",
			unavailableKey: "assistUnavailableAI"
		}];
		//#endregion
		//#region src/client/qr-code.ts
		/** Mode indicator for 8-bit byte mode. */
		const MODE_BYTE = 4;
		/**
		* Data capacity, in bytes, for levels M by version (1-20), byte mode.
		*
		* From the Model 2 capacity tables: total codewords minus the error-correction
		* codewords for that version, minus the mode/length header, rounded down. Held
		* as a table because the block structures below are also tabulated and driving
		* one from the other invites an off-by-one that only shows up at one version.
		*/
		const BYTE_CAPACITY_M = [
			14,
			26,
			42,
			62,
			84,
			106,
			122,
			152,
			180,
			213,
			251,
			287,
			331,
			362,
			412,
			450,
			504,
			560,
			624,
			666
		];
		const BLOCKS_M = [
			{
				ecPerBlock: 10,
				groups: [[1, 16]]
			},
			{
				ecPerBlock: 16,
				groups: [[1, 28]]
			},
			{
				ecPerBlock: 26,
				groups: [[1, 44]]
			},
			{
				ecPerBlock: 18,
				groups: [[2, 32]]
			},
			{
				ecPerBlock: 24,
				groups: [[2, 43]]
			},
			{
				ecPerBlock: 16,
				groups: [[4, 27]]
			},
			{
				ecPerBlock: 18,
				groups: [[4, 31]]
			},
			{
				ecPerBlock: 22,
				groups: [[2, 38], [2, 39]]
			},
			{
				ecPerBlock: 22,
				groups: [[3, 36], [2, 37]]
			},
			{
				ecPerBlock: 26,
				groups: [[4, 43], [1, 44]]
			},
			{
				ecPerBlock: 30,
				groups: [[1, 50], [4, 51]]
			},
			{
				ecPerBlock: 22,
				groups: [[6, 36], [2, 37]]
			},
			{
				ecPerBlock: 22,
				groups: [[8, 37], [1, 38]]
			},
			{
				ecPerBlock: 24,
				groups: [[4, 40], [5, 41]]
			},
			{
				ecPerBlock: 24,
				groups: [[5, 41], [5, 42]]
			},
			{
				ecPerBlock: 28,
				groups: [[7, 45], [3, 46]]
			},
			{
				ecPerBlock: 28,
				groups: [[10, 46], [1, 47]]
			},
			{
				ecPerBlock: 26,
				groups: [[9, 43], [4, 44]]
			},
			{
				ecPerBlock: 26,
				groups: [[3, 44], [11, 45]]
			},
			{
				ecPerBlock: 26,
				groups: [[3, 41], [13, 42]]
			}
		];
		/**
		* Alignment pattern centre coordinates per version.
		*
		* The spec's own table; the arithmetic rule that generates it has exceptions at
		* the low versions and the table is shorter to read than the rule.
		*/
		const ALIGNMENT_CENTRES = [
			[],
			[6, 18],
			[6, 22],
			[6, 26],
			[6, 30],
			[6, 34],
			[
				6,
				22,
				38
			],
			[
				6,
				24,
				42
			],
			[
				6,
				26,
				46
			],
			[
				6,
				28,
				50
			],
			[
				6,
				30,
				54
			],
			[
				6,
				32,
				58
			],
			[
				6,
				34,
				62
			],
			[
				6,
				26,
				46,
				66
			],
			[
				6,
				26,
				48,
				70
			],
			[
				6,
				26,
				50,
				74
			],
			[
				6,
				30,
				54,
				78
			],
			[
				6,
				30,
				56,
				82
			],
			[
				6,
				30,
				58,
				86
			],
			[
				6,
				34,
				62,
				90
			]
		];
		function encodeQrCode(text, options = {}) {
			const bytes = new TextEncoder().encode(text);
			const version = smallestVersion(bytes.length);
			if (version === void 0) throw new Error(`QR payload of ${String(bytes.length)} bytes exceeds the supported capacity`);
			const size = version * 4 + 17;
			return {
				size,
				modules: placeCodewords(buildCodewords(bytes, version), version, size, options.mask)
			};
		}
		/** The lowest version whose level-M byte capacity fits, or undefined. */
		function smallestVersion(byteLength) {
			for (let index = 0; index < BYTE_CAPACITY_M.length; index += 1) if (byteLength <= BYTE_CAPACITY_M[index]) return index + 1;
		}
		/**
		* The final codeword sequence: mode + length + data + terminator + padding,
		* split into blocks, each block extended with its own Reed–Solomon codewords,
		* then interleaved in the spec's order.
		*/
		function buildCodewords(bytes, version) {
			const layout = BLOCKS_M[version - 1];
			const totalData = layout.groups.reduce((sum, [count, per]) => sum + count * per, 0);
			const bits = [];
			pushBits(bits, MODE_BYTE, 4);
			pushBits(bits, bytes.length, version < 10 ? 8 : 16);
			for (const byte of bytes) pushBits(bits, byte, 8);
			const capacityBits = totalData * 8;
			pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
			pushBits(bits, 0, (8 - bits.length % 8) % 8);
			const data = [];
			for (let index = 0; index < bits.length; index += 8) {
				let value = 0;
				for (let offset = 0; offset < 8; offset += 1) value = value << 1 | (bits[index + offset] ?? 0);
				data.push(value);
			}
			const PAD = [236, 17];
			for (let index = 0; data.length < totalData; index += 1) data.push(PAD[index % 2]);
			const blocks = [];
			let cursor = 0;
			for (const [count, per] of layout.groups) for (let block = 0; block < count; block += 1) {
				blocks.push(data.slice(cursor, cursor + per));
				cursor += per;
			}
			const ecBlocks = blocks.map((block) => reedSolomon(block, layout.ecPerBlock));
			const out = [];
			const maxData = Math.max(...blocks.map((block) => block.length));
			for (let index = 0; index < maxData; index += 1) for (const block of blocks) {
				const value = block[index];
				if (value !== void 0) out.push(value);
			}
			for (let index = 0; index < layout.ecPerBlock; index += 1) for (const block of ecBlocks) {
				const value = block[index];
				if (value !== void 0) out.push(value);
			}
			return out;
		}
		/** Append the low `count` bits of `value`, most significant first. */
		function pushBits(bits, value, count) {
			for (let shift = count - 1; shift >= 0; shift -= 1) bits.push(value >> shift & 1);
		}
		/**
		* Reed–Solomon codewords over GF(256) with the QR primitive polynomial 0x11d.
		*
		* The remainder of the message times `x^ecLength` divided by the generator
		* polynomial, computed with the shift register the spec describes.
		*/
		function reedSolomon(data, ecLength) {
			const generator = generatorPolynomial(ecLength).slice(1);
			const remainder = new Array(ecLength).fill(0);
			for (const byte of data) {
				const factor = byte ^ remainder[0];
				remainder.shift();
				remainder.push(0);
				for (let index = 0; index < ecLength; index += 1) remainder[index] = remainder[index] ^ gfMultiply(factor, generator[index]);
			}
			return remainder;
		}
		/**
		* The degree-`ecLength` generator polynomial, as coefficients with the leading
		* 1 dropped: `(x - a^0)(x - a^1)...(x - a^(ecLength-1))`.
		*/
		function generatorPolynomial(ecLength) {
			let polynomial = [1];
			for (let index = 0; index < ecLength; index += 1) {
				const next = new Array(polynomial.length + 1).fill(0);
				for (let term = 0; term < polynomial.length; term += 1) {
					next[term] = next[term] ^ polynomial[term];
					next[term + 1] = next[term + 1] ^ gfMultiply(polynomial[term], gfPower(index));
				}
				polynomial = next;
			}
			return polynomial;
		}
		/** Multiply two GF(256) elements modulo the QR primitive polynomial. */
		function gfMultiply(left, right) {
			let result = 0;
			let a = left;
			let b = right;
			while (b > 0) {
				if ((b & 1) === 1) result ^= a;
				a <<= 1;
				if (a > 255) a ^= 285;
				b >>= 1;
			}
			return result;
		}
		/** `2` raised to the `power`-th in GF(256), used to build the generator. */
		function gfPower(power) {
			let value = 1;
			for (let index = 0; index < power; index += 1) value = gfMultiply(value, 2);
			return value;
		}
		function placeCodewords(codewords, version, size, forced) {
			if (forced !== void 0) {
				const matrix = new Matrix(size);
				drawFunctionPatterns(matrix, version);
				drawCodewords(matrix, codewords);
				applyMask(matrix, forced);
				drawFormatBits(matrix, forced);
				return matrix.modules.slice();
			}
			const matrix = new Matrix(size);
			drawFunctionPatterns(matrix, version);
			drawCodewords(matrix, codewords);
			let best;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let mask = 0; mask < 8; mask += 1) {
				const candidate = new Matrix(size);
				drawFunctionPatterns(candidate, version);
				drawCodewords(candidate, codewords);
				applyMask(candidate, mask);
				drawFormatBits(candidate, mask);
				const score = penalty(candidate);
				if (score < bestScore) {
					bestScore = score;
					best = candidate.modules.slice();
				}
			}
			if (best === void 0) throw new Error("QR mask selection produced no candidate");
			return best;
		}
		/** A square of modules with typed access, so the builder reads as coordinates. */
		var Matrix = class {
			size;
			modules;
			/** Which modules are function patterns and must not be masked or overwritten. */
			reserved;
			constructor(size) {
				this.size = size;
				this.modules = new Array(size * size).fill(false);
				this.reserved = new Array(size * size).fill(false);
			}
			get(x, y) {
				return this.modules[y * this.size + x] === true;
			}
			set(x, y, dark) {
				if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
				this.modules[y * this.size + x] = dark;
			}
			mark(x, y) {
				if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
				this.reserved[y * this.size + x] = true;
			}
		};
		/** Finder patterns, separators, timing, alignment, and the dark module. */
		function drawFunctionPatterns(matrix, version) {
			const size = matrix.size;
			for (const [originX, originY] of [
				[0, 0],
				[size - 7, 0],
				[0, size - 7]
			]) for (let y = -1; y <= 7; y += 1) for (let x = -1; x <= 7; x += 1) {
				const px = originX + x;
				const py = originY + y;
				const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
				const edge = inside && (x === 0 || x === 6 || y === 0 || y === 6);
				const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
				matrix.set(px, py, inside && (edge || core));
				matrix.mark(px, py);
			}
			for (let index = 8; index < size - 8; index += 1) {
				const dark = index % 2 === 0;
				matrix.set(index, 6, dark);
				matrix.mark(index, 6);
				matrix.set(6, index, dark);
				matrix.mark(6, index);
			}
			const centres = ALIGNMENT_CENTRES[version - 1];
			for (const centreY of centres) for (const centreX of centres) {
				if (centreX === 6 && centreY === 6 || centreX === 6 && centreY === size - 7 || centreX === size - 7 && centreY === 6) continue;
				for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
					const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
					matrix.set(centreX + x, centreY + y, dark);
					matrix.mark(centreX + x, centreY + y);
				}
			}
			reserveFormatAreas(matrix, version);
			matrix.set(8, size - 8, true);
			matrix.mark(8, size - 8);
		}
		/** Mark the format/version modules as reserved so data never lands on them. */
		function reserveFormatAreas(matrix, version) {
			const size = matrix.size;
			for (let index = 0; index < 9; index += 1) {
				matrix.mark(index, 8);
				matrix.mark(8, index);
			}
			for (let index = 0; index < 8; index += 1) {
				matrix.mark(size - 1 - index, 8);
				matrix.mark(8, size - 1 - index);
			}
			if (version >= 7) for (let y = 0; y < 6; y += 1) for (let x = size - 11; x < size - 8; x += 1) {
				matrix.mark(x, y);
				matrix.mark(y, x);
			}
		}
		/**
		* Walk the symbol in the spec's zigzag — right to left in two-column pairs,
		* alternating upward and downward — placing the codeword bits.
		*/
		function drawCodewords(matrix, codewords) {
			const size = matrix.size;
			let bitIndex = 0;
			let upward = true;
			for (let right = size - 1; right >= 1; right -= 2) {
				if (right === 6) right = 5;
				for (let step = 0; step < size; step += 1) {
					const y = upward ? size - 1 - step : step;
					for (const x of [right, right - 1]) {
						if (matrix.reserved[y * size + x] === true) continue;
						const byte = codewords[bitIndex >> 3];
						const dark = byte === void 0 ? false : (byte >> 7 - (bitIndex & 7) & 1) === 1;
						matrix.set(x, y, dark);
						bitIndex += 1;
					}
				}
				upward = !upward;
			}
		}
		/** XOR the mask pattern over every non-function module. */
		function applyMask(matrix, mask) {
			const size = matrix.size;
			for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
				if (matrix.reserved[y * size + x] === true) continue;
				if (!maskApplies(mask, x, y)) continue;
				matrix.modules[y * size + x] = !matrix.get(x, y);
			}
		}
		/** The eight mask conditions of the spec, by index. */
		function maskApplies(mask, x, y) {
			switch (mask) {
				case 0: return (x + y) % 2 === 0;
				case 1: return y % 2 === 0;
				case 2: return x % 3 === 0;
				case 3: return (x + y) % 3 === 0;
				case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
				case 5: return x * y % 2 + x * y % 3 === 0;
				case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
				case 7: return ((x + y) % 2 + x * y % 3) % 2 === 0;
				default: return false;
			}
		}
		/** Write the format information for `mask` (and the version blocks, if any). */
		function drawFormatBits(matrix, mask) {
			const size = matrix.size;
			const data = 0 | mask;
			let shifted = data << 10;
			for (let index = 14; index >= 10; index -= 1) if ((shifted >> index & 1) === 1) shifted ^= 1335 << index - 10;
			const bits = (data << 10 | shifted) ^ 21522;
			const bit = (index) => (bits >> index & 1) === 1;
			for (let index = 0; index <= 5; index += 1) matrix.set(8, index, bit(index));
			matrix.set(8, 7, bit(6));
			matrix.set(8, 8, bit(7));
			matrix.set(7, 8, bit(8));
			for (let index = 9; index <= 14; index += 1) matrix.set(14 - index, 8, bit(index));
			for (let index = 0; index <= 7; index += 1) matrix.set(size - 1 - index, 8, bit(index));
			for (let index = 8; index <= 14; index += 1) matrix.set(8, size - 15 + index, bit(index));
			matrix.set(8, size - 8, true);
			const version = (size - 17) / 4;
			if (version < 7) return;
			let versionRemainder = version;
			for (let index = 0; index < 12; index += 1) versionRemainder = versionRemainder << 1 ^ (versionRemainder >> 11 & 1) * 7973;
			const versionBits = version << 12 | versionRemainder;
			for (let index = 0; index < 18; index += 1) {
				const dark = (versionBits >> index & 1) === 1;
				const a = Math.floor(index / 3);
				const b = index % 3;
				matrix.set(size - 11 + b, a, dark);
				matrix.set(a, size - 11 + b, dark);
			}
		}
		/** The spec's four penalty rules, summed. Lower is a better mask. */
		function penalty(matrix) {
			const size = matrix.size;
			let score = 0;
			for (let y = 0; y < size; y += 1) {
				let runColour = matrix.get(0, y);
				let runLength = 1;
				for (let x = 1; x < size; x += 1) {
					const colour = matrix.get(x, y);
					if (colour === runColour) runLength += 1;
					else {
						if (runLength >= 5) score += runLength - 2;
						runColour = colour;
						runLength = 1;
					}
				}
				if (runLength >= 5) score += runLength - 2;
			}
			for (let x = 0; x < size; x += 1) {
				let runColour = matrix.get(x, 0);
				let runLength = 1;
				for (let y = 1; y < size; y += 1) {
					const colour = matrix.get(x, y);
					if (colour === runColour) runLength += 1;
					else {
						if (runLength >= 5) score += runLength - 2;
						runColour = colour;
						runLength = 1;
					}
				}
				if (runLength >= 5) score += runLength - 2;
			}
			for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
				const colour = matrix.get(x, y);
				if (colour === matrix.get(x + 1, y) && colour === matrix.get(x, y + 1) && colour === matrix.get(x + 1, y + 1)) score += 3;
			}
			const DARK_LIGHT_RUN = 1488;
			const LIGHT_DARK_RUN = 93;
			for (let y = 0; y < size; y += 1) {
				let across = 0;
				let down = 0;
				for (let index = 0; index < size; index += 1) {
					across = across << 1 & 2047 | (matrix.get(index, y) ? 1 : 0);
					if (index >= 10 && (across === DARK_LIGHT_RUN || across === LIGHT_DARK_RUN)) score += 40;
					down = down << 1 & 2047 | (matrix.get(y, index) ? 1 : 0);
					if (index >= 10 && (down === DARK_LIGHT_RUN || down === LIGHT_DARK_RUN)) score += 40;
				}
			}
			let dark = 0;
			for (const module of matrix.modules) if (module) dark += 1;
			const steps = Math.abs(Math.ceil(dark * 100 / (size * size) / 5) - 10);
			score += steps * 10;
			return score;
		}
		//#endregion
		//#region src/client/segmented.tsx
		/**
		* The two-or-more-way segmented switch, with a sliding selection.
		*
		* One component for every switch in this plugin — the sign-in method, and a
		* model's context length — because they are the same control: a small set of
		* mutually exclusive choices where the selection is what matters, not the
		* buttons. Keeping one implementation is also what makes the motion consistent;
		* two copies would drift the first time one of them was adjusted.
		*
		* The selection is an absolutely positioned pill that translates between slots,
		* rather than each button painting its own background. That is what makes the
		* movement read as *the selection moving* instead of one thing vanishing and
		* another appearing, and it is why the pill is measured from the buttons rather
		* than given an equal share of the track: the buttons size themselves to their
		* labels, so equal shares would drift out of alignment.
		*
		* @module dsh-workbuddy-connect/client/segmented
		*/
		const trackStyle = {
			position: "relative",
			display: "inline-flex",
			alignItems: "stretch",
			padding: 3,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05))",
			overflow: "hidden"
		};
		const itemStyle = {
			position: "relative",
			zIndex: 1,
			border: 0,
			borderRadius: 999,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			fontFamily: "inherit",
			cursor: "pointer",
			whiteSpace: "nowrap",
			transition: "color 160ms ease"
		};
		/**
		* The moving selection.
		*
		* Colour and shadow live here so the buttons stay flat; only the text colour
		* changes on the selected one, which is what lets the pill animate underneath
		* without the label flashing.
		*/
		const pillStyle = {
			position: "absolute",
			top: 3,
			bottom: 3,
			zIndex: 0,
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv1, 0 1px 2px rgba(0, 0, 0, 0.08))",
			transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1)"
		};
		/** Whether the user has asked for less motion. */
		function prefersReducedMotion() {
			try {
				return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			} catch {
				return false;
			}
		}
		function SegmentedControl({ options, value, onChange, label, disabled, dense, block }) {
			const trackRef = (0, react.useRef)(null);
			/** The selected slot's geometry within the track, in px. */
			const [pill, setPill] = (0, react.useState)();
			const [animate, setAnimate] = (0, react.useState)(false);
			const selectedIndex = options.findIndex((option) => option.value === value);
			/**
			* Measure the selected button.
			*
			* `useLayoutEffect` rather than an effect: measuring after paint would show
			* the pill at its previous position for one frame on first render, which reads
			* as a flicker. The measurement is repeated on resize because the labels'
			* widths depend on the font the browser actually resolved.
			*/
			(0, react.useLayoutEffect)(() => {
				const track = trackRef.current;
				if (track === null) return;
				const measure = () => {
					const button = [...track.querySelectorAll("button")][selectedIndex];
					if (button === void 0) return;
					setPill({
						left: button.offsetLeft,
						width: button.offsetWidth
					});
				};
				measure();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(measure);
				observer.observe(track);
				return () => {
					observer.disconnect();
				};
			}, [
				selectedIndex,
				options,
				dense,
				block
			]);
			(0, react.useEffect)(() => {
				if (pill === void 0) return;
				const timer = window.setTimeout(() => {
					setAnimate(true);
				}, 30);
				return () => {
					window.clearTimeout(timer);
				};
			}, [pill === void 0]);
			const reduced = prefersReducedMotion();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: trackRef,
				role: "radiogroup",
				"aria-label": label,
				style: {
					...trackStyle,
					...block === true ? { display: "flex" } : {},
					...disabled === true ? { opacity: .6 } : {}
				},
				children: [pill === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						...pillStyle,
						transform: `translateX(${String(pill.left - 3)}px)`,
						width: pill.width,
						...animate && !reduced ? {} : { transition: "none" }
					}
				}), options.map((option, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					role: "radio",
					"aria-checked": index === selectedIndex,
					"aria-label": option.title ?? option.label,
					disabled: disabled === true,
					onClick: () => {
						if (index !== selectedIndex) onChange(option.value);
					},
					style: {
						...itemStyle,
						...dense === true ? {
							padding: "2px 10px",
							fontSize: 12,
							lineHeight: "18px"
						} : {
							padding: "5px 18px",
							fontSize: 13,
							lineHeight: "18px"
						},
						...block === true ? { flex: 1 } : {},
						...index === selectedIndex ? {
							color: "var(--dsw-alias-label-primary)",
							fontWeight: 600
						} : {}
					},
					children: option.label
				}, String(option.value)))]
			});
		}
		//#endregion
		//#region src/client/WorkBuddySettingsPage.tsx
		/**
		* The WorkBuddy settings page: every pooled account, for both products, with
		* the total credit each product has left.
		*
		* Why this is a settings *page* rather than a card in the Plugins tab: the two
		* products together are a resource the user checks and acts on — add an
		* account, see what is left, delete one that lapsed — and that is a destination,
		* not a footnote under a plugin list. The Plugins tab keeps the plugin's own
		* card; this page is where the accounts live.
		*
		* Layout, per product:
		*
		*   [grey heading  WorkBuddy]                     [+ Add account]
		*   [account rows: name, balance, test, remove]
		*   [total credit]
		*
		* The two products stay separate all the way down — separate pools, separate
		* totals — because a sum across them would be a number that describes nothing:
		* the credits are not convertible and the accounts are not interchangeable.
		*
		* @module dsh-workbuddy-connect/client/settings-page
		*/
		/** How often a QR challenge is checked. */
		const POLL_INTERVAL_MS$1 = 2e3;
		/** How often the page re-reads both products while it is open. */
		const REFRESH_INTERVAL_MS = 6e4;
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 16,
			padding: "4px 0 24px"
		};
		const cardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			padding: "18px 20px 20px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const groupStyle$1 = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const groupHeadStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		/**
		* The product heading. Deliberately small, grey, and unprominent: it labels a
		* block inside one card, and a full-size heading here would read as a second
		* card boundary.
		*/
		const groupTitleStyle = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			fontWeight: 600,
			letterSpacing: .2,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			padding: "9px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const rowMainStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			minWidth: 0
		};
		const dotStyle$1 = {
			width: 8,
			height: 8,
			borderRadius: "50%",
			flex: "0 0 auto"
		};
		const nameStyle = {
			fontSize: 14,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const balanceStyle = {
			fontSize: 13,
			lineHeight: "20px",
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-secondary)",
			whiteSpace: "nowrap"
		};
		const metaStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** A model row plus the confirmation it can expand into. */
		const rowColumnStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 8
		};
		/** One-line confirmation of a paid detection, in the row that asked for it. */
		const confirmBoxStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const confirmRowStyle$1 = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		/** Name over product label: a column so the name's ellipsis cannot clip it. */
		const nameColumnStyle = {
			display: "flex",
			flexDirection: "column",
			minWidth: 0
		};
		/**
		* The product an account belongs to.
		*
		* Uppercased in CSS rather than in copy, so the label matches the product names
		* the rest of the page uses while still reading as a quiet classification rather
		* than a second title. Smaller and dimmer than the name it sits under.
		*/
		const productStyle = {
			fontSize: 11,
			lineHeight: "15px",
			letterSpacing: .4,
			textTransform: "uppercase",
			color: "var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary))"
		};
		/** The per-product totals, side by side under one label. */
		const totalsStyle = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 16,
			flexWrap: "wrap"
		};
		const totalPairStyle = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 6
		};
		const totalProductStyle = {
			fontSize: 11,
			lineHeight: "16px",
			letterSpacing: .4,
			textTransform: "uppercase",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const totalProductValueStyle = {
			fontSize: 20,
			lineHeight: "26px",
			fontWeight: 600,
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-primary)"
		};
		/** A promotional or "free" chip beside a model name. */
		const badgeStyle = {
			flex: "0 0 auto",
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			background: "var(--dsw-alias-state-success-subtle, rgba(34, 160, 107, 0.12))",
			color: "var(--dsw-alias-state-success-primary, #22a06b)",
			whiteSpace: "nowrap"
		};
		const rowEndStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			flex: "0 0 auto"
		};
		const buttonStyle$1 = {
			boxSizing: "border-box",
			minHeight: 30,
			padding: "4px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 15,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: "18px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const dangerStyle = {
			...buttonStyle$1,
			color: "var(--dsw-alias-state-error-primary, #d92d20)"
		};
		const primaryStyle = {
			...buttonStyle$1,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		const totalRowStyle = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: 12,
			paddingTop: 10,
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		const totalLabelStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 4e3,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			background: "rgba(0, 0, 0, 0.45)"
		};
		const dialogStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			width: "min(400px, 100%)",
			maxHeight: "100%",
			overflowY: "auto",
			padding: "18px 18px 16px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)"
		};
		const dialogTitleStyle = {
			margin: 0,
			fontSize: 16,
			lineHeight: "24px",
			fontWeight: 600,
			textAlign: "center"
		};
		const dialogBodyStyle = {
			margin: 0,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const dialogActionsStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const qrFrameStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 12,
			borderRadius: 10,
			background: "#fff"
		};
		const tokenAreaStyle = {
			boxSizing: "border-box",
			width: "100%",
			minHeight: 96,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			resize: "vertical",
			wordBreak: "break-all"
		};
		/**
		* Paint a QR symbol into a canvas.
		*
		* An integer number of device pixels per module: a fractional scale softens the
		* module edges, which is the one thing that makes a camera struggle to lock on.
		*/
		function QrCanvas({ text, modulePixels }) {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const canvas = ref.current;
				if (canvas === null) return;
				let code;
				try {
					code = encodeQrCode(text);
				} catch {
					return;
				}
				const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
				const moduleSize = Math.max(1, Math.floor(modulePixels * ratio / code.size));
				const side = moduleSize * code.size;
				canvas.width = side;
				canvas.height = side;
				canvas.style.width = `${String(Math.round(side / ratio))}px`;
				canvas.style.height = `${String(Math.round(side / ratio))}px`;
				const context = canvas.getContext("2d");
				if (context === null) return;
				context.fillStyle = "#fff";
				context.fillRect(0, 0, side, side);
				context.fillStyle = "#000";
				for (let y = 0; y < code.size; y += 1) for (let x = 0; x < code.size; x += 1) {
					if (code.modules[y * code.size + x] !== true) continue;
					context.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
				}
			}, [text, modulePixels]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
				ref,
				role: "img",
				"aria-label": "QR",
				style: { display: "block" }
			});
		}
		/** The dot's colour: what rotation thinks of this account right now. */
		function statusColor$1(account, now) {
			if (account.sessionDead === true || account.enabled !== true) return "var(--dsw-alias-label-dimmed, #9aa0a6)";
			const cooldown = account.cooldown;
			if (cooldown !== void 0 && cooldown.untilMs > now) return "var(--dsw-alias-state-warning-primary, #b45309)";
			return "var(--dsw-alias-state-success-primary, #22a06b)";
		}
		/** One account row: name, balance, and the two things you can do to it. */
		function AccountRow({ account, product, busy, now, t, onAction }) {
			const cooldown = account.cooldown;
			const waiting = cooldown !== void 0 && cooldown.untilMs > now;
			const expired = account.expiresAtMs > 0 && account.expiresAtMs <= now && account.renewable !== true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: rowMainStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle$1,
							background: statusColor$1(account, now)
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: nameColumnStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: nameStyle,
							title: account.name,
							children: account.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: productStyle,
							children: product
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: rowEndStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: waiting ? {
								...balanceStyle,
								color: "var(--dsw-alias-state-warning-primary, #b45309)"
							} : balanceStyle,
							children: waiting ? t("accountStateWaiting", {
								reason: t(cooldown?.reason === "credit" ? "accountStateExhausted" : cooldown?.reason === "session" ? "accountStateSessionDead" : "accountStateLimited"),
								when: waitLabel(cooldown?.untilMs ?? 0, now, t)
							}) : expired ? t("accountExpired") : account.credits === void 0 ? t("accountCreditsPending") : t("accountCredits", { total: new Intl.NumberFormat(void 0).format(account.credits) })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle$1,
							disabled: busy,
							onClick: () => {
								onAction({
									action: "test",
									id: account.id
								});
							},
							children: t("accountTest")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: dangerStyle,
							disabled: busy,
							onClick: () => {
								if (window.confirm(t("accountRemoveConfirm", { name: account.name }))) onAction({
									action: "remove",
									id: account.id
								});
							},
							children: t("accountRemove")
						})
					]
				})]
			});
		}
		/**
		* The promotional chips one model row shows, without saying "free" twice.
		*
		* The upstream's own badge text is shown verbatim rather than translated — it is
		* the product's own wording for its own promotion ("Free now", "限时免费"), and
		* restating it in this plugin's language would be inventing copy for a claim the
		* upstream made.
		*
		* The deduplication exists because a free model can arrive with *both* facts: a
		* badge naming the promotion, and the `free` flag the rate was derived from. The
		* international catalog does exactly that, which rendered "Free now" and "Free"
		* side by side. When a badge already says the model is free, the derived chip is
		* dropped — the badge is the specific claim, and this one is only the summary.
		*/
		function promotionChips(model, freeLabel) {
			const badges = model.badges ?? [];
			const alreadySaysFree = badges.some((badge) => /free/i.test(badge) || badge.includes("免费"));
			return [...badges, ...model.free === true && !alreadySaysFree ? [freeLabel] : []];
		}
		/**
		* A cooldown's remaining time, worded for the reader.
		*
		* The unit decision is shared (`describeWait`); only the words are local, which
		* is why this composes them here rather than inside the document contract.
		*/
		function waitLabel(untilMs, now, t) {
			const wait = describeWait(untilMs, now);
			return t(wait.unit === "hour" ? "waitHours" : "waitMinutes", { value: wait.value });
		}
		/** A token count as the switch's label: 1M reads better than 1000000. */
		function shortTokens(tokens) {
			if (tokens >= 1e6 && tokens % 1e6 === 0) return `${String(tokens / 1e6)}M`;
			if (tokens >= 1e3 && tokens % 1e3 === 0) return `${String(tokens / 1e3)}K`;
			return String(tokens);
		}
		/**
		* The model list for one product: a context-length switch where the upstream
		* declares a choice, and a reasoning-level detection button where the model has
		* levels worth discovering.
		*
		* Both controls are writes and share the key-bearing route the account actions
		* use. Detection sits here rather than only in the composer because it is a
		* property of the model you are looking at — reading down the list with the
		* models in front of you is the moment you notice one has no levels declared,
		* and having to go and pick that model first to fix it was the roundabout part.
		*/
		function ModelsBlock({ variant, status, probe, busy, t, onContext, onRefresh, onDetect, onClearProbe }) {
			const signedIn = status !== void 0 && status.status === "signed-in" ? status : void 0;
			const models = signedIn?.models ?? [];
			const catalog = signedIn?.catalog;
			const format = new Intl.DateTimeFormat(void 0, {
				dateStyle: "short",
				timeStyle: "short"
			});
			/**
			* Which model is waiting for the user to agree to a detection.
			*
			* Detection sends real requests against the user's own quota, so it asks
			* first — inline, in the row the button belongs to, rather than in a modal:
			* the question is one line about the model beside it, and a dialog for that is
			* heavier than the action it guards.
			*/
			const [pending, setPending] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (pending !== void 0 && !(probe?.candidates ?? []).includes(pending)) setPending(void 0);
			}, [pending, probe?.candidates]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: groupStyle$1,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: groupHeadStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
						style: groupTitleStyle,
						children: [t("modelsHeading"), models.length === 0 ? "" : ` · ${t("modelsCount", { count: models.length })}`]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: rowEndStyle,
						children: [catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: metaStyle,
							children: catalog.source === "live" && catalog.fetchedAt !== void 0 ? t("modelsSourceLive", { time: format.format(new Date(catalog.fetchedAt)) }) : catalog.source === "saved" && catalog.fetchedAt !== void 0 ? t("modelsSourceSaved", { time: format.format(new Date(catalog.fetchedAt)) }) : t("modelsSourceFallback")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle$1,
							disabled: busy,
							onClick: onRefresh,
							children: t("modelsRefresh")
						})]
					})]
				}), models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: metaStyle,
					children: t("modelsEmpty")
				}) : models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowColumnStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: rowMainStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: nameStyle,
									title: model.name,
									children: model.name
								}),
								promotionChips(model, t("freeModel")).map((chip) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: badgeStyle,
									children: chip
								}, chip)),
								model.credits === void 0 ? model.rateUnknown === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: metaStyle,
									children: t("rateUnknown")
								}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: metaStyle,
									children: t("rate", { rate: model.credits })
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: rowEndStyle,
							children: [probe === void 0 || !probe.candidates.includes(model.id) ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: rowEndStyle,
								children: [(() => {
									const result = probe.results.find((entry) => entry.id === model.id);
									if (result === void 0) return null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: badgeStyle,
										title: t("probeTooltipVerified", { levels: result.efforts.join(" / ") }),
										children: result.validation === "validating" && result.efforts.length > 0 ? result.efforts.join(" / ") : t(result.validation === "non-validating" ? "probeResultNotValidating" : "probeResultUnknown")
									});
								})(), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy || probe.running === true,
									title: t("probeTooltipIdle", { model: model.name }),
									onClick: () => {
										setPending(model.id);
									},
									children: (() => {
										return t(probe.results.find((entry) => entry.id === model.id) === void 0 ? "probeStart" : "probeRedetect");
									})()
								})]
							}), model.contextChoices === void 0 || model.contextChoices.length < 2 ? model.contextWindow === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: metaStyle,
								children: [
									t("contextHeading"),
									" ",
									shortTokens(model.contextWindow)
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegmentedControl, {
								dense: true,
								label: `${t("contextLabel")}: ${model.name}`,
								disabled: busy,
								value: model.contextChoice ?? model.contextChoices[0] ?? 0,
								options: model.contextChoices.map((length) => ({
									value: length,
									label: shortTokens(length),
									title: t("contextSwitchTitle", { size: shortTokens(length) })
								})),
								onChange: (length) => {
									onContext(model.id, length);
								}
							})]
						})]
					}), pending !== model.id ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: confirmBoxStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: metaStyle,
							children: t("probeConfirmBody", { model: model.name })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: confirmRowStyle$1,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle$1,
								onClick: () => {
									setPending(void 0);
								},
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryStyle,
								disabled: busy || probe?.running === true,
								onClick: () => {
									setPending(void 0);
									onDetect(model.id);
								},
								children: t("probeConfirmAction")
							})]
						})]
					})]
				}, model.id))]
			});
		}
		/**
		* Every account from every product, as one list.
		*
		* Why the two pools are shown together: an account is an account — the user is
		* looking at "what can serve a request right now", and splitting that answer by
		* product made the list read as two separate features when it is one. Which
		* product a row belongs to is still on the row, as a quiet label under the name,
		* because that is the one fact that must not be inferred: the two products'
		* credits are not convertible and their models are not shared.
		*
		* The totals stay separate for the same reason; summing them would produce a
		* number that describes nothing.
		*/
		function AccountsSection({ entries, statuses, busy, now, t, onAdd, onAction }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: groupStyle$1,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: groupHeadStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: groupTitleStyle,
							children: t("accountHeading")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle$1,
							disabled: busy,
							onClick: onAdd,
							children: t("accountAdd")
						})]
					}),
					entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: metaStyle,
						children: t("accountEmpty")
					}) : entries.map(({ account, variant }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountRow, {
						account,
						product: t(variant.titleKey),
						busy,
						now,
						t,
						onAction: (action) => {
							onAction(variant, action);
						}
					}, account.id)),
					totalRows(statuses, t)
				]
			});
		}
		/** One product's total, when that product has accounts at all. */
		function totalRows(statuses, t) {
			const rows = CARD_VARIANTS.flatMap((variant) => {
				const status = statuses[variant.id];
				const list = status !== void 0 && "accounts" in status ? status.accounts?.accounts ?? [] : [];
				if (list.length === 0) return [];
				const known = list.map((account) => account.credits).filter((value) => typeof value === "number");
				const total = known.reduce((sum, value) => sum + value, 0);
				return [{
					id: variant.id,
					name: t(variant.titleKey),
					total: known.length === 0 ? void 0 : total
				}];
			});
			if (rows.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: totalRowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: totalLabelStyle,
					children: t("accountTotalCredits")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: totalsStyle,
					children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: totalPairStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: totalProductStyle,
							children: row.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: totalProductValueStyle,
							children: row.total === void 0 ? "—" : new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(row.total)
						})]
					}, row.id))
				})]
			});
		}
		/** The list a user picks a product from before the login dialog opens. */
		function ProductPicker({ t, onPick, onCancel }) {
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: dialogStyle,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("accountAddTitle"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: dialogTitleStyle,
							children: t("accountAddTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: dialogBodyStyle,
							children: t("accountAddPickHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle$1,
							onClick: () => {
								onPick(CARD_VARIANTS[0]);
							},
							children: t("accountAddCn")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle$1,
							onClick: () => {
								onPick(CARD_VARIANTS[1]);
							},
							children: t("accountAddAi")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: dialogActionsStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle$1,
								onClick: onCancel,
								children: t("cancel")
							})
						})
					]
				})
			}), document.body);
		}
		/**
		* The sign-in dialog for one product.
		*
		* Both products offer a browser sign-in and a pasted token. Only the CN product
		* offers the scannable code: the international QR endpoint answers, but there is
		* no app on a phone that completes it, so showing a code would be offering a
		* path that cannot be walked. The international product's browser route is
		* therefore a plain link to its console rather than a QR.
		*
		* The browser route only *starts* a sign-in — it is the console, and the plugin
		* cannot observe what happens there. So the token half is not a fallback for it
		* but its other half: the user signs in on the web, copies the token, and pastes
		* it. The copy says so rather than leaving the two tabs unexplained.
		*/
		function AddAccountDialog({ variant, t, busy, error, onCancel, onSubmitQr, onPollQr, onSubmitToken }) {
			const qrSupported = variant.id === "workbuddy";
			const [mode, setMode] = (0, react.useState)(qrSupported ? "qr" : "web");
			const [challenge, setChallenge] = (0, react.useState)();
			const [token, setToken] = (0, react.useState)("");
			const [remaining, setRemaining] = (0, react.useState)(0);
			const stopped = (0, react.useRef)(false);
			/**
			* Whether this dialog has already asked for a challenge.
			*
			* A ref, not the `challenge` state: a failed `add` answers with no challenge
			* at all, so keying the effect on the state alone would re-run it on every
			* render the failure caused, firing `add` in a loop. The dialog asks once per
			* opening and offers the explicit actions below after that.
			*/
			const asked = (0, react.useRef)(false);
			/**
			* Mint a challenge as soon as a route that needs one is shown.
			*
			* Both routes do: the code route renders the URL as a QR, and the browser
			* route opens it. That is what makes the browser route a real sign-in rather
			* than a link to a marketing page — the `authUrl` the host mints *is* the
			* product's login page, carrying the state the host is already polling.
			*/
			(0, react.useEffect)(() => {
				if (mode !== "qr" && mode !== "web" || asked.current) return;
				asked.current = true;
				stopped.current = false;
				onSubmitQr().then((next) => {
					if (stopped.current || next === void 0) return;
					setChallenge(next);
				});
			}, [mode, onSubmitQr]);
			/**
			* Open the minted login page in the system browser, once.
			*
			* Automatic rather than behind a button: the user already chose "sign in on
			* the web", so making them click again to reach the page that choice names
			* would be asking the same question twice. A ref keeps a re-render from
			* opening a second tab.
			*/
			const opened = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (mode !== "web" || challenge === void 0 || opened.current) return;
				opened.current = true;
				window.open(challenge.authUrl, "_blank", "noopener,noreferrer");
			}, [mode, challenge]);
			(0, react.useEffect)(() => {
				if (challenge === void 0) return;
				setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()));
				const tick = window.setInterval(() => {
					setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()));
				}, 1e3);
				return () => {
					window.clearInterval(tick);
				};
			}, [challenge]);
			(0, react.useEffect)(() => {
				if (challenge === void 0 || stopped.current) return;
				const poll = window.setInterval(() => {
					onPollQr(challenge.state).then((keep) => {
						if (!keep) stopped.current = true;
					});
				}, POLL_INTERVAL_MS$1);
				return () => {
					window.clearInterval(poll);
				};
			}, [challenge, onPollQr]);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [onCancel]);
			(0, react.useEffect)(() => () => {
				stopped.current = true;
			}, []);
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				role: "presentation",
				onClick: (event) => {
					if (event.target === event.currentTarget) onCancel();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: dialogStyle,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t(variant.titleKey),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: dialogTitleStyle,
							children: t("accountAddTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								justifyContent: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegmentedControl, {
								label: t("accountActionLogin"),
								value: mode,
								options: qrSupported ? [{
									value: "qr",
									label: t("accountLoginQr")
								}, {
									value: "token",
									label: t("accountLoginToken")
								}] : [{
									value: "web",
									label: t("accountLoginWeb")
								}, {
									value: "token",
									label: t("accountLoginToken")
								}],
								onChange: setMode
							})
						}),
						mode === "qr" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountAddBody")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: qrFrameStyle,
								children: challenge === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: metaStyle,
									children: t("loading")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QrCanvas, {
									text: challenge.authUrl,
									modulePixels: 232
								})
							}),
							challenge === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountAddWaiting", { seconds: Math.ceil(remaining / 1e3) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: dialogActionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: challenge === void 0,
									onClick: () => {
										if (challenge !== void 0) window.open(challenge.authUrl, "_blank", "noopener,noreferrer");
									},
									children: t("accountOpenLink")
								})
							})
						] }) : mode === "web" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountWebBody")
							}),
							challenge === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: metaStyle,
								children: t("loading")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountWebWaiting", { seconds: Math.ceil(remaining / 1e3) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: dialogActionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: challenge === void 0,
									onClick: () => {
										if (challenge !== void 0) window.open(challenge.authUrl, "_blank", "noopener,noreferrer");
									},
									children: t("accountOpenLink")
								})
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("accountTokenBody")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								style: tokenAreaStyle,
								value: token,
								placeholder: t("accountTokenPlaceholder"),
								spellCheck: false,
								onChange: (event) => {
									setToken(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: dialogActionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryStyle,
									disabled: busy || token.trim() === "",
									onClick: () => {
										onSubmitToken(token);
									},
									children: busy ? t("accountChecking") : t("accountSubmit")
								})
							})
						] }),
						error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								...dialogBodyStyle,
								color: "var(--dsw-alias-state-error-primary, #d92d20)"
							},
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: dialogActionsStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle$1,
								onClick: onCancel,
								children: t("cancel")
							})
						})
					]
				})
			}), document.body);
		}
		/**
		* The page itself: one card, two product blocks.
		*
		* Each product is driven by its own status document, so a failure or a slow
		* answer on one never blocks or blanks the other.
		*/
		function WorkBuddySettingsPage({ t }) {
			const [statuses, setStatuses] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [picking, setPicking] = (0, react.useState)(false);
			const [adding, setAdding] = (0, react.useState)();
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				const tick = window.setInterval(() => {
					setNow(Date.now());
				}, 3e4);
				return () => {
					window.clearInterval(tick);
				};
			}, []);
			const readAll = (0, react.useCallback)(async (signal) => {
				const answers = await Promise.all(CARD_VARIANTS.map(async (variant) => {
					try {
						const response = await fetch(variant.statusPath, {
							headers: { accept: "application/json" },
							credentials: "same-origin",
							...signal === void 0 ? {} : { signal }
						});
						if (!response.ok) return void 0;
						return [variant.id, await response.json()];
					} catch {
						return;
					}
				}));
				if (!mounted.current || signal?.aborted === true) return;
				const next = {};
				for (const answer of answers) if (answer !== void 0) next[answer[0]] = answer[1];
				setStatuses(next);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				readAll(controller.signal);
				const tick = window.setInterval(() => {
					readAll(controller.signal);
				}, REFRESH_INTERVAL_MS);
				return () => {
					window.clearInterval(tick);
					controller.abort();
				};
			}, [readAll]);
			/** The control key, which the status documents hand out in both sign-in states. */
			const keyFor = (0, react.useCallback)((variant) => {
				const status = statuses[variant.id];
				return status !== void 0 && "probeKey" in status ? status.probeKey : void 0;
			}, [statuses]);
			const run = (0, react.useCallback)(async (variant, action) => {
				const key = keyFor(variant);
				if (key === void 0) {
					setError(t("requestFailed"));
					return;
				}
				const response = await fetch(variant.accountPath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-WorkBuddy-Probe-Key": key
					},
					credentials: "same-origin",
					body: JSON.stringify(action)
				});
				const value = await response.json().catch(() => void 0);
				if (!response.ok) {
					const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${String(response.status)}`;
					setError(message);
					return;
				}
				return value;
			}, [keyFor, t]);
			const submitQr = (0, react.useCallback)(async (variant) => {
				setError(void 0);
				setBusy(true);
				try {
					const result = await run(variant, { action: "add" });
					if (result?.challenge === void 0) {
						setError(result?.reason ?? t("requestFailed"));
						return;
					}
					return result.challenge;
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [run, t]);
			const pollQr = (0, react.useCallback)(async (variant, state) => {
				const result = await run(variant, {
					action: "poll",
					state
				});
				if (result === void 0) return false;
				if (result.state === "waiting") return true;
				if (result.state === "added") {
					setAdding(void 0);
					setError(void 0);
					await readAll();
					return false;
				}
				setError(result.reason ?? t(result.state === "expired" ? "accountQrExpired" : "accountQrInvalid"));
				return false;
			}, [
				readAll,
				run,
				t
			]);
			const submitToken = (0, react.useCallback)(async (variant, token) => {
				setError(void 0);
				setBusy(true);
				try {
					const result = await run(variant, {
						action: "add-cookie",
						token
					});
					if (result === void 0) return false;
					if (result.state !== "added") {
						setError(result.reason ?? t("requestFailed"));
						return false;
					}
					setAdding(void 0);
					await readAll();
					return true;
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [
				readAll,
				run,
				t
			]);
			/**
			* Ask the host to re-fetch this product's model list.
			*
			* Shares the probe route's `refresh` action rather than the account route:
			* the work is a catalog fetch, and that is what the probe route already does.
			*/
			const refreshModels = (0, react.useCallback)((variant) => {
				const key = keyFor(variant);
				if (key === void 0) return;
				setBusy(true);
				setError(void 0);
				fetch(variant.probePath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-WorkBuddy-Probe-Key": key
					},
					credentials: "same-origin",
					body: JSON.stringify({ action: "refresh" })
				}).then(async (response) => {
					const value = await response.json().catch(() => void 0);
					if (!response.ok) setError(`HTTP ${String(response.status)}`);
					else if (typeof value === "object" && value !== null && "state" in value && value.state === "failed") setError(String(value["reason"] ?? t("requestFailed")));
					await readAll();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : t("requestFailed"));
				}).finally(() => {
					if (mounted.current) setBusy(false);
				});
			}, [
				keyFor,
				readAll,
				t
			]);
			/**
			* Detect one model's reasoning levels.
			*
			* A write on the probe route, beside its `refresh`: the probe endpoint owns
			* detection, and the account route owns the pool. Returns nothing — the
			* re-read afterwards is what updates the row.
			*/
			const probeAction = (0, react.useCallback)((variant, body) => {
				const key = keyFor(variant);
				if (key === void 0) return;
				setBusy(true);
				setError(void 0);
				fetch(variant.probePath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-WorkBuddy-Probe-Key": key
					},
					credentials: "same-origin",
					body: JSON.stringify(body)
				}).then(async (response) => {
					const value = await response.json().catch(() => void 0);
					if (!response.ok) setError(`HTTP ${String(response.status)}`);
					else if (typeof value === "object" && value !== null && "state" in value && value.state === "unavailable") setError(String(value["reason"] ?? t("requestFailed")));
					await readAll();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : t("requestFailed"));
				}).finally(() => {
					if (mounted.current) setBusy(false);
				});
			}, [
				keyFor,
				readAll,
				t
			]);
			const accountAction = (0, react.useCallback)((variant, action) => {
				setError(void 0);
				setBusy(true);
				run(variant, action).then(async (result) => {
					if (result === void 0) return;
					if (result.state === "failed") setError(result.reason ?? t("requestFailed"));
					else if (action.action === "test" && result.test !== void 0) setError(result.test.ok ? void 0 : `${t("accountTestFailed")}: ${result.test.message}`);
					await readAll();
				}).finally(() => {
					if (mounted.current) setBusy(false);
				});
			}, [
				readAll,
				run,
				t
			]);
			/**
			* This product's detection state, when the document carries one.
			*
			* Read off the document rather than narrowed through `status`, for the same
			* reason the account section is: `probe` is optional, and a narrowed union
			* loses it.
			*/
			const probeFor = (0, react.useCallback)((variant) => {
				const status = statuses[variant.id];
				return status === void 0 || !("probe" in status) ? void 0 : status.probe;
			}, [statuses]);
			/**
			* Every product's accounts in one list, each tagged with its product.
			*
			* Tagged rather than looked up later: a row's controls must post to the route
			* of the pool the account actually lives in, and the only thing that decides
			* that is which status document it came from.
			*/
			const taggedAccounts = CARD_VARIANTS.flatMap((variant) => {
				const status = statuses[variant.id];
				if (status === void 0 || !("accounts" in status)) return [];
				return (status.accounts?.accounts ?? []).map((account) => ({
					account,
					variant
				}));
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: pageStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountsSection, {
							entries: taggedAccounts,
							statuses,
							busy,
							now,
							t,
							onAdd: () => {
								setError(void 0);
								setPicking(true);
							},
							onAction: accountAction
						}), CARD_VARIANTS.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsBlock, {
							variant,
							status: statuses[variant.id],
							probe: probeFor(variant),
							busy,
							t,
							onContext: (model, length) => {
								accountAction(variant, {
									action: "context",
									model,
									length
								});
							},
							onRefresh: () => {
								refreshModels(variant);
							},
							onDetect: (model) => {
								probeAction(variant, {
									action: "probe",
									model
								});
							},
							onClearProbe: () => {
								probeAction(variant, { action: "clear" });
							}
						}, variant.id))]
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...metaStyle,
							color: "var(--dsw-alias-state-error-primary, #d92d20)"
						},
						children: error
					}),
					picking ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProductPicker, {
						t,
						onPick: (picked) => {
							setPicking(false);
							setAdding(picked);
						},
						onCancel: () => {
							setPicking(false);
						}
					}) : null,
					adding === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddAccountDialog, {
						variant: adding,
						t,
						busy,
						...error === void 0 ? {} : { error },
						onCancel: () => {
							setAdding(void 0);
							setError(void 0);
						},
						onSubmitQr: () => submitQr(adding),
						onPollQr: (state) => pollQr(adding, state),
						onSubmitToken: (token) => submitToken(adding, token)
					})
				]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyFloatingAccounts.tsx
		/**
		* The floating account window: both variants' accounts, over the conversation.
		*
		* Why a portal instead of a slot occupant that lays out in place: the window has
		* to sit over the conversation's top-right corner *without* taking header space,
		* and the only slot that renders inside the conversation is the header itself.
		* So the occupant renders nothing in flow, and everything it has to show goes
		* through a portal onto \`document.body\` with a fixed position derived from the
		* conversation's own scroll container.
		*
		* That derivation is the part worth reading: the offsets come from
		* \`[data-conversation-scroll]\`'s bounding box rather than from hardcoded
		* pixels, so the window follows the conversation when the sidebars open, the
		* window resizes, or the header height changes. A missing anchor falls back to a
		* viewport-relative corner, which keeps the window usable if DSH's markup moves.
		*
		* @module dsh-workbuddy-connect/client/floating-accounts
		*/
		/** How often the window re-reads both status documents. */
		const POLL_INTERVAL_MS = 6e4;
		/** Distance from the conversation's top-right corner, in px. */
		const INSET = 16;
		/** Remembered collapsed/expanded state; a preference, not session state. */
		const COLLAPSED_KEY = "dsh-workbuddy-connect:floating-collapsed";
		const panelStyle = {
			position: "fixed",
			zIndex: 900,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 232,
			maxHeight: "min(60vh, 420px)",
			overflowY: "auto",
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.96))",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			overscrollBehavior: "contain"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8
		};
		const titleStyle = {
			fontSize: 12,
			fontWeight: 600,
			color: "var(--dsw-alias-label-secondary)"
		};
		const iconButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 20,
			height: 20,
			padding: 0,
			border: 0,
			borderRadius: 5,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			fontSize: 14,
			lineHeight: 1,
			cursor: "pointer"
		};
		const groupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 4
		};
		const groupNameStyle = {
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const accountRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 8
		};
		const accountNameStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const valueStyle = {
			flex: "0 0 auto",
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-secondary)"
		};
		const waitingStyle = {
			...valueStyle,
			color: "var(--dsw-alias-state-warning-primary, #b45309)"
		};
		const collapsedStyle = {
			...panelStyle,
			width: "auto",
			maxHeight: "none",
			padding: "6px 10px"
		};
		/**
		* A cooldown's remaining time, worded for the reader.
		*
		* `describeWait` decides the unit — shared with the settings page so the two
		* surfaces cannot describe one account differently — and the words are local.
		*/
		function waitWords(untilMs, now, t) {
			const wait = describeWait(untilMs, now);
			return t(wait.unit === "hour" ? "waitHours" : "waitMinutes", { value: wait.value });
		}
		function statusColor(status) {
			if (status === "signed-in") return "var(--dsw-alias-state-success-primary, #22a06b)";
			if (status === "error") return "var(--dsw-alias-state-error-primary, #d92d20)";
			return "var(--dsw-alias-label-dimmed, #9aa0a6)";
		}
		const dotStyle = {
			width: 7,
			height: 7,
			borderRadius: "50%",
			flex: "0 0 auto"
		};
		/**
		* Compute the window's viewport position from the conversation's scroll area.
		*
		* Falls back to a viewport corner when the anchor is absent (a different DSH
		* build, or the settings page — where the window does not render at all).
		*/
		function anchorNow() {
			const container = document.querySelector("[data-conversation-scroll]");
			if (container === null) return {
				top: 64,
				right: INSET
			};
			const rect = container.getBoundingClientRect();
			const right = Math.max(INSET, window.innerWidth - rect.right + INSET);
			return {
				top: Math.max(INSET, rect.top + INSET),
				right
			};
		}
		/** One account's line inside the window. */
		function AccountLine({ account, now, t }) {
			const cooldown = account.cooldown;
			const waiting = cooldown !== void 0 && cooldown.untilMs > now;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: accountRowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: accountNameStyle,
					title: account.name,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle,
							background: account.available ? "var(--dsw-alias-state-success-primary, #22a06b)" : waiting ? "var(--dsw-alias-state-warning-primary, #b45309)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							overflow: "hidden",
							textOverflow: "ellipsis"
						},
						children: account.name
					})]
				}), waiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: waitingStyle,
					children: t("floatingRetryIn", { when: waitWords(cooldown?.untilMs ?? 0, now, t) })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: valueStyle,
					children: account.credits === void 0 ? "—" : new Intl.NumberFormat(void 0, {
						notation: "compact",
						maximumFractionDigits: 1
					}).format(account.credits)
				})]
			});
		}
		/**
		* The window itself, driven by both variants' status documents.
		*
		* Registered **once**, not per variant: the window merges both products' pools,
		* so a per-variant occupant would paint two identical windows on top of each
		* other. The occupant renders nothing in flow — its output is the portal below.
		*/
		function WorkBuddyFloatingAccounts({ t }) {
			const [statuses, setStatuses] = (0, react.useState)({});
			const [anchor, setAnchor] = (0, react.useState)();
			const [collapsed, setCollapsed] = (0, react.useState)(() => {
				try {
					return window.localStorage.getItem(COLLAPSED_KEY) === "1";
				} catch {
					return false;
				}
			});
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const readAll = (0, react.useCallback)(async (signal) => {
				const entries = await Promise.all(CARD_VARIANTS.map(async (variant) => {
					try {
						const response = await fetch(variant.statusPath, {
							headers: { accept: "application/json" },
							credentials: "same-origin",
							...signal === void 0 ? {} : { signal }
						});
						if (!response.ok) return void 0;
						return [variant.id, await response.json()];
					} catch {
						return;
					}
				}));
				if (!mounted.current || signal?.aborted === true) return;
				const next = {};
				for (const entry of entries) if (entry !== void 0) next[entry[0]] = entry[1];
				setStatuses(next);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				readAll(controller.signal);
				const timer = window.setInterval(() => {
					readAll(controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [readAll]);
			(0, react.useEffect)(() => {
				const update = () => {
					setAnchor(anchorNow());
				};
				update();
				window.addEventListener("resize", update);
				const container = document.querySelector("[data-conversation-scroll]");
				const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(update);
				if (container !== null) observer?.observe(container);
				observer?.observe(document.body);
				return () => {
					window.removeEventListener("resize", update);
					observer?.disconnect();
				};
			}, []);
			const toggle = (0, react.useCallback)(() => {
				setCollapsed((previous) => {
					const next = !previous;
					try {
						window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
					} catch {}
					return next;
				});
			}, []);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 3e4);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			const showing = CARD_VARIANTS.filter((variant) => statuses[variant.id] !== void 0);
			if (showing.length === 0 || anchor === void 0) return null;
			if (!showing.some((variant) => {
				const status = statuses[variant.id];
				return status?.status === "signed-in" && status.accounts?.floatingWindow === true;
			})) return null;
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...collapsed ? collapsedStyle : panelStyle,
					top: anchor.top,
					right: anchor.right
				},
				role: "complementary",
				"aria-label": t("floatingTitle"),
				"data-workbuddy-floating-accounts": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: headerStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: titleStyle,
						children: collapsed ? t("floatingTitle") : t("floatingTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: iconButtonStyle,
						"aria-expanded": !collapsed,
						"aria-label": t(collapsed ? "floatingExpand" : "floatingCollapse"),
						title: t(collapsed ? "floatingExpand" : "floatingCollapse"),
						onClick: toggle,
						children: collapsed ? "⌃" : "⌄"
					})]
				}), collapsed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						...groupNameStyle,
						display: "flex",
						gap: 6,
						alignItems: "center"
					},
					children: showing.map((variant) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...dotStyle,
							background: statusColor(statuses[variant.id]?.status)
						}
					}, variant.id))
				}) : showing.map((variant) => {
					const status = statuses[variant.id];
					const accounts = status?.status === "signed-in" ? status.accounts : void 0;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: groupStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: groupNameStyle,
							children: t(variant.titleKey)
						}), accounts === void 0 || accounts.accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: groupNameStyle,
							children: t("floatingNoAccount")
						}) : accounts.accounts.filter((account) => account.enabled).map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountLine, {
							account,
							now,
							t
						}, account.id))]
					}, variant.id);
				})]
			}), document.body);
		}
		//#endregion
		//#region src/client/status-document.ts
		/**
		* Whether a parsed status response really is a status document.
		*
		* A 200 is not a promise about the body: it may be empty, literal `null`, a
		* non-JSON page from a proxy, or an array. Both halves of the browser plugin
		* read the same route, so both must agree on what is valid — storing an
		* unreadable value puts something in state that the next render dereferences.
		*
		* The check is deliberately limited to the discriminator (plus `error`'s
		* `message`, which the error paragraph renders): validating optional fields
		* here would reject documents the host legitimately omits fields from.
		*
		* `reasonCode` is therefore *not* rejected here — a card renders `reason`
		* either way — but every reader must narrow it with
		* `isWorkBuddySignedOutReasonCode` before branching on it, since the wire
		* value is not guaranteed to be inside the enum.
		*/
		function isWorkBuddyWebStatus(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const wrapped = value;
			const status = wrapped["status"];
			if (status === "signed-out" || status === "signed-in") return true;
			return status === "error" && typeof wrapped["message"] === "string";
		}
		//#endregion
		//#region src/client/WorkBuddyProbeControl.tsx
		/**
		* Per-model reasoning-effort entry beside the Composer's model selector.
		*
		* Interaction follows the Fast Mode control `dsh-codex-connect` ships in this
		* same seat, which is the established shape for composer chrome here:
		*
		* - a **static inline label** next to the icon names the feature ("Reasoning
		*   levels"), set smaller and dimmer than the surrounding chrome so it reads as
		*   an annotation on the icon. It never carries state: the verified levels
		*   already appear in the model dropdown (the adapter exposes them as
		*   selectable efforts), so repeating them here would duplicate the real answer
		*   and make the label's width jump as results change.
		* - a **hover/focus tooltip** carries the state and the click's purpose, the way
		*   Fast Mode's tooltip explains its current speed.
		* - the **confirmation** is a small bubble anchored to the control, not a
		*   `window.confirm`. Probing spends real credit, so a confirmation stays — but
		*   it belongs next to the thing it acts on, sized to one line plus two small
		*   buttons.
		*
		* @module dsh-workbuddy-connect/client/probe-control
		*/
		/**
		* The card (and therefore the routes) a selected provider belongs to.
		*
		* The control serves both WorkBuddy providers from one seat, so the provider id
		* is what selects the status and probe endpoints. Returning `undefined` for any
		* other provider is what keeps the icon off every non-WorkBuddy model.
		*/
		function cardVariantFor(provider) {
			return CARD_VARIANTS.find((card) => card.id === provider);
		}
		/** How often the control re-checks state when the window regains focus. */
		const RECONCILE_MS = 6e4;
		const wrapperStyle = {
			display: "inline-flex",
			position: "relative",
			alignItems: "center",
			transform: "translateY(2px)",
			marginRight: -8
		};
		const buttonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 2,
			height: 30,
			padding: "0 6px",
			border: 0,
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		/**
		* The inline label. Smaller and dimmer than the surrounding chrome on purpose:
		* it names the feature, so it should read as an annotation attached to the icon
		* rather than compete with the adjacent model selector.
		*/
		const labelStyle = {
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Tooltip bubble: the Fast Mode shape (nowrap, one line, above the control). */
		const tooltipStyle = {
			position: "absolute",
			left: "50%",
			bottom: "calc(100% + 8px)",
			zIndex: 1e3,
			transform: "translateX(-50%)",
			padding: "4px 8px",
			borderRadius: 6,
			background: "var(--dsw-specific-tip, #1f2329)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary, #fff)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap",
			pointerEvents: "none"
		};
		/** Confirmation bubble: same anchor, but interactive and allowed to wrap. */
		const confirmStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 260,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		const confirmRowStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const confirmButtonStyle = {
			padding: "3px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		/**
		* Primary action inside the confirmation bubble.
		*
		* The fill and its text colour must come as a pair: `brand-primary` resolves to
		* a light accent in this theme, so hardcoding `color: #fff` on top of it renders
		* white-on-white. `button-primary-fill` + `label-primary-foreground` is the
		* theme's own pair for exactly this, and is what `dsh-codex-connect` uses for
		* the same job.
		*/
		const primaryButtonStyle = {
			...confirmButtonStyle,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		/**
		* Result note: a single line + a dismiss button, anchored to the control's
		* right side. Smaller than the confirmation bubble because it carries an
		* *outcome*, not a *decision* — the work is done, the user only has to read
		* and dismiss.
		*/
		const noteStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			alignItems: "center",
			gap: 12,
			padding: "6px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap"
		};
		/**
		* The note's dismiss action. Outlined rather than bare text: inside an already
		* bordered bubble, an unbordered word does not read as something you can click.
		* Matches the outlined pill convention the plugin's other secondary actions use.
		*/
		const noteDismissStyle = {
			padding: "2px 8px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer"
		};
		/**
		* The feature's static inline label. Deliberately not a state readout — see the
		* module comment.
		*/
		function useLabel(t) {
			return t("probeLabel");
		}
		/** Pick the model's recorded observation out of the probe section. */
		function resultFor(status, model) {
			if (status.status !== "signed-in") return void 0;
			return status.probe?.results.find((result) => result.id === model);
		}
		/**
		* The one-line tooltip: current state first, then what a click does — the same
		* two-part shape Fast Mode uses.
		*
		* A recorded result outranks a remembered failure. `failed` only means "the last
		* run from this control did not complete"; the host can record a result for the
		* same model at any time (a detection started from the settings card, another
		* conversation, or a finished sweep), and the levels the user paid for are the
		* more useful answer than the stale failure. Failure copy is what remains when
		* there is no result to report.
		*/
		function tooltipText(t, model, state) {
			if (state.busy) return t("probeRunning", { model });
			const result = state.result;
			if (result !== void 0) {
				if (result.validation === "validating" && result.efforts.length > 0) return t("probeTooltipVerified", { levels: result.efforts.join(" / ") });
				if (result.validation === "non-validating") return t("probeTooltipNotValidating");
				return t("probeTooltipRetry");
			}
			if (state.failed) return t("probeTooltipRetry");
			return t("probeTooltipIdle", { model });
		}
		/** Model-independent shell: resolves the selection, then delegates per model. */
		function WorkBuddyProbeControl({ directory, t }) {
			const subscribe = (0, react.useCallback)((listener) => directory.subscribe(listener), [directory]);
			const snapshot = (0, react.useCallback)(() => directory.getSnapshot(), [directory]);
			const selection = (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot).current;
			const card = selection === void 0 ? void 0 : cardVariantFor(selection.provider);
			const key = card === void 0 || selection === void 0 ? void 0 : `${card.id}:${selection.model}`;
			return card === void 0 || selection === void 0 || key === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				label: useLabel(t),
				t
			}, key);
		}
		function ModelProbe({ model, card, label, t }) {
			const [status, setStatus] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const [tooltipVisible, setTooltipVisible] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)();
			const inFlight = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const readSeq = (0, react.useRef)(0);
			const tooltipId = (0, react.useId)();
			const refresh = (0, react.useCallback)(async (signal) => {
				const seq = ++readSeq.current;
				const response = await fetch(card.statusPath, {
					credentials: "same-origin",
					headers: { accept: "application/json" },
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const value = await response.json().catch(() => void 0);
				if (!isWorkBuddyWebStatus(value)) throw new Error(t("statusResponseInvalid"));
				if (mounted.current && !signal?.aborted && seq === readSeq.current) setStatus(value);
			}, [card.statusPath, t]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				const load = () => {
					refresh(controller.signal).catch(() => {});
				};
				load();
				const timer = window.setInterval(load, RECONCILE_MS);
				window.addEventListener("focus", load);
				return () => {
					mounted.current = false;
					controller.abort();
					window.clearInterval(timer);
					window.removeEventListener("focus", load);
				};
			}, [refresh]);
			const probe = status?.status === "signed-in" ? status.probe : void 0;
			const key = status?.status === "signed-in" ? status.probeKey : void 0;
			const result = status === void 0 ? void 0 : resultFor(status, model);
			const visible = probe?.candidates.includes(model) === true || result !== void 0;
			(0, react.useEffect)(() => {
				if (result !== void 0) setFailed(false);
			}, [result]);
			(0, react.useEffect)(() => {
				setConfirming(false);
				setNote(void 0);
			}, [model]);
			const detect = async () => {
				if (key === void 0 || inFlight.current || probe?.running === true) return;
				inFlight.current = true;
				setNote(void 0);
				setConfirming(false);
				setBusy(true);
				setFailed(false);
				try {
					const response = await fetch(card.probePath, {
						method: "POST",
						credentials: "same-origin",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						body: JSON.stringify({
							action: "probe",
							model
						})
					});
					const body = await response.json();
					if (!response.ok || body.state !== "ok" || body.validation !== "validating" && body.validation !== "non-validating" || !Array.isArray(body.efforts) || !body.efforts.every((effort) => typeof effort === "string")) throw new Error("probe failed");
					if (mounted.current) {
						const completed = {
							id: model,
							name: model,
							validation: body.validation,
							efforts: body.efforts,
							probedAt: Date.now()
						};
						setNote(completed);
					}
					refresh().catch(() => {});
				} catch {
					if (mounted.current) setFailed(true);
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			if (!visible) return null;
			const text = tooltipText(t, model, {
				busy,
				result,
				failed
			});
			const disabled = busy || probe?.running === true || key === void 0;
			const showTooltip = tooltipVisible && !confirming && note === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: wrapperStyle,
				onMouseEnter: () => {
					setTooltipVisible(true);
				},
				onMouseLeave: () => {
					setTooltipVisible(false);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-label": text,
						"aria-describedby": showTooltip ? tooltipId : void 0,
						"aria-busy": busy,
						"aria-expanded": confirming,
						disabled,
						onClick: () => {
							setConfirming(true);
						},
						onFocus: () => {
							setTooltipVisible(true);
						},
						onBlur: () => {
							setTooltipVisible(false);
						},
						style: {
							...buttonStyle,
							opacity: disabled && !confirming ? .6 : 1,
							cursor: disabled ? "default" : "pointer"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "16",
							height: "16",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.6",
							"aria-hidden": "true",
							focusable: "false",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "9"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "4"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 12 20 4" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "1"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: labelStyle,
							children: label
						})]
					}),
					showTooltip && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: tooltipId,
						role: "tooltip",
						style: tooltipStyle,
						children: text
					}),
					confirming && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: confirmStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("probeBubbleBody") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: confirmRowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: confirmButtonStyle,
								onClick: () => {
									setConfirming(false);
								},
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle,
								onClick: () => {
									detect();
								},
								children: t("probeConfirmAction")
							})]
						})]
					}),
					note === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						role: "status",
						"aria-live": "polite",
						style: noteStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: noteText(t, note) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: noteDismissStyle,
							onClick: () => {
								setNote(void 0);
							},
							children: t("probeNoteDismiss")
						})]
					})
				]
			});
		}
		/** Compose the one-line outcome string the note bubble shows. */
		function noteText(t, result) {
			if (result.validation === "validating" && result.efforts.length > 0) return t("probeNoteVerified", { levels: result.efforts.join(" / ") });
			if (result.validation === "non-validating") return t("probeNoteNotValidating");
			return t("probeNoteUnknown");
		}
		//#endregion
		//#region src/client/panel-copy.ts
		/**
		* Copy for the WorkBuddy dashboard: the sidebar footer card and the centre
		* column panel.
		*
		* Its own namespace (panel.workbuddy), separate from the settings page's
		* settings.workbuddy, because the panel is not part of the settings page —
		* but it follows the SAME active language: both slots declare this namespace
		* at registration, which is what binds their t seat, and a language switch
		* mints a fresh t that re-renders the surfaces (see panel-view.tsx).
		*
		* @module dsh-workbuddy-connect/client/panel-copy
		*/
		/** Locale namespace the panel's surfaces register under. */
		const PANEL_LOCALE_NS = "panel.workbuddy";
		/** English dictionary; the key domain for both surfaces. */
		const PANEL_COPY_EN = {
			/** Panel title and the sidebar card's own label. */
			nav: "WorkBuddy",
			/** Heading over the per-product account totals. */
			accounts: "Accounts",
			/** Heading over the per-product model figures. */
			models: "Models",
			/** Heading listing the per-product sign-in states. */
			signIn: "Sign-in",
			/** The dashboard's refresh action. */
			refresh: "Refresh",
			/** The dashboard's way back to the Conversation. */
			close: "Close",
			/** Shown while a read is in flight and nothing has arrived yet. */
			loading: "Reading the WorkBuddy pools…",
			/** Shown when nothing has ever been read (no host route answered). */
			unavailable: "The host did not report its pools. Update the plugin, or restart DSH.",
			/** Accounts in the pool, per product. */
			accountCount: "{count}",
			/** One product's total remaining credit. */
			creditTotal: "{total}",
			/** A product whose accounts report no balance yet. */
			creditPending: "—",
			/** Models currently served, per product. */
			modelCount: "{count}",
			/** Where the served model list came from: a live upstream fetch. */
			sourceLive: "Live",
			/** Where the served model list came from: this account's last saved fetch. */
			sourceSaved: "Saved",
			/** Where the served model list came from: the roster compiled into the plugin. */
			sourceFallback: "Built-in",
			/** The product's pool has an account and can serve requests. */
			signedIn: "Signed in",
			/** No account: the product can serve nothing. */
			signedOut: "Not signed in",
			/** The pool has accounts but none may be used right now. */
			allUnavailable: "All accounts are set aside",
			/** The host reported a failure for this product. */
			failure: "Read failed",
			/** A limit leaves N accounts benched until their stated reset. */
			benched: "{count} set aside",
			/** The footer card's accessible name and tooltip. */
			footerLabel: "WorkBuddy — open the dashboard",
			/** The rail icon's accessible name. */
			railLabel: "WorkBuddy dashboard"
		};
		/** Chinese dictionary; every key above, in the same order. */
		const PANEL_COPY_ZH = {
			nav: "WorkBuddy",
			accounts: "账号",
			models: "模型",
			signIn: "登录状态",
			refresh: "刷新",
			close: "关闭",
			loading: "正在读取 WorkBuddy 账号池…",
			unavailable: "宿主未返回账号池。请更新插件或重启 DSH。",
			accountCount: "{count}",
			creditTotal: "{total}",
			creditPending: "—",
			modelCount: "{count}",
			sourceLive: "实时",
			sourceSaved: "已保存",
			sourceFallback: "内置",
			signedIn: "已登录",
			signedOut: "未登录",
			allUnavailable: "全部账号被搁置",
			failure: "读取失败",
			benched: "{count} 个搁置中",
			footerLabel: "WorkBuddy —— 打开仪表盘",
			railLabel: "WorkBuddy 仪表盘"
		};
		/** Fill {name} placeholders from a parameter record. */
		function interpolate(template, params) {
			return template.replace(/\{(\w+)\}/gu, (match, name) => name in params ? String(params[name]) : match);
		}
		/** English fallback used when a registration carries no locale seat. */
		const panelTextEN = (key, params = {}) => interpolate(PANEL_COPY_EN[key], params);
		/**
		* A translator that prefers the harness's active language and falls back to
		* English per key, so a dictionary missing one string (an older bundle, a
		* partially translated locale) still renders a readable panel.
		*/
		function panelTranslator(t) {
			if (t === void 0) return panelTextEN;
			return (key, params = {}) => {
				const translated = t(key, params);
				return translated === key ? interpolate(PANEL_COPY_EN[key], params) : translated;
			};
		}
		//#endregion
		//#region src/client/panel.ts
		/** Thousands-separated integer, using the reader's own grouping. */
		function formatCount(value) {
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);
		}
		/**
		* Total remaining credit for one product's pool, or undefined when no account
		* reported a balance.
		*
		* Deliberately a SUM over accounts that answered, not over the pool: a pool
		* where one account's lookup failed would otherwise show a figure that silently
		* treats the missing account as zero. Products are never summed together — the
		* two subscriptions' credits are not convertible — which is why this is
		* per-product and there is no grand total anywhere in the view.
		*/
		function creditTotal(accounts) {
			const known = accounts.filter((account) => account.credits !== void 0);
			if (known.length === 0) return void 0;
			return known.reduce((sum, account) => sum + (account.credits ?? 0), 0);
		}
		/** Whether an account is benched right now. */
		function isBenched(account, now) {
			return account.cooldown !== void 0 && account.cooldown.untilMs > now;
		}
		/**
		* The single key naming a product's sign-in state.
		*
		* The pool is the authority — "signed in" means *the pool has an account*, not
		* that the desktop app is signed in — so the state is read from the account
		* section the host sends in both states, never inferred from a missing one.
		*/
		function productState(status) {
			if (status === void 0) return "unknown";
			if (status.status === "error") return "error";
			return status.status === "signed-in" ? "signed-in" : "signed-out";
		}
		/** Accounts the document carries, whichever sign-in state it is in. */
		function accountsOf(status) {
			if (status === void 0 || status.status === "error") return [];
			return status.accounts?.accounts ?? [];
		}
		/**
		* The one-line explanation a product shows under its name, when it has one.
		*
		* Precedence is deliberate: a host failure outranks a sign-in reason (it means
		* the plugin could not answer at all), and a sign-in reason outranks the
		* generic signed-out hint (it names the file to fix).
		*/
		function detailOf(status) {
			if (status === void 0) return void 0;
			if (status.status === "error") return status.message;
			return status.status === "signed-out" ? status.reason : void 0;
		}
		/** One product's block, from its own status document. */
		function productView(variant, status, now) {
			const accounts = accountsOf(status);
			const benched = accounts.filter((account) => isBenched(account, now)).length;
			const total = creditTotal(accounts);
			const models = status !== void 0 && status.status === "signed-in" ? status.models ?? [] : [];
			const catalogSource = status !== void 0 && status.status === "signed-in" ? status.catalog?.source ?? "none" : "none";
			const stats = [
				{
					label: "accountCount",
					value: formatCount(accounts.length)
				},
				{
					label: "creditTotal",
					value: total === void 0 ? "" : formatCount(total),
					...total === void 0 ? { pending: "creditPending" } : {}
				},
				{
					label: "modelCount",
					value: formatCount(models.length)
				}
			];
			return {
				id: variant.id,
				name: variant.appName,
				state: productState(status),
				...detailOf(status) === void 0 ? {} : { detail: detailOf(status) },
				stats,
				benched,
				catalogSource
			};
		}
		/**
		* Project one snapshot into the panel's view.
		*
		* `available` is a fact about the HOST, not about sign-in: with no route
		* answering, the dashboard says so once instead of rendering two products that
		* look signed out for reasons the plugin cannot see.
		*/
		function buildPanelView(options) {
			const { snapshot } = options;
			const now = options.now ?? Date.now();
			const products = CARD_VARIANTS.map((variant) => productView(variant, snapshot.statuses[variant.id], now));
			const accountCount = products.reduce((sum, product) => sum + countOf(product, "accountCount"), 0);
			const modelCount = products.reduce((sum, product) => sum + countOf(product, "modelCount"), 0);
			const benchedCount = products.reduce((sum, product) => sum + product.benched, 0);
			return {
				products,
				loading: snapshot.loading && snapshot.fetchedAt === 0,
				available: snapshot.fetchedAt > 0,
				accountCount,
				benchedCount,
				modelCount,
				footTitle: footTitle(products)
			};
		}
		/** Read one numeric stat back out of a product block. */
		function countOf(product, label) {
			const stat = product.stats.find((candidate) => candidate.label === label);
			if (stat === void 0 || stat.value === "") return 0;
			return Number(stat.value.replace(/\D/gu, "")) || 0;
		}
		/**
		* The footer card's tooltip: the product count plus each product's own state,
		* so the card's accessible name carries the same facts its visible rows do.
		*/
		function footTitle(products) {
			return products.map((product) => product.state === "signed-in" ? product.name + ": " + String(countOf(product, "accountCount")) + "/" + String(countOf(product, "modelCount")) : product.name + ": " + product.state).join(" · ");
		}
		//#endregion
		//#region src/client/panel-hooks.ts
		/**
		* React binding for the shared panel store: the `useSyncExternalStore` seat
		* both panel surfaces read through, plus the two effects that keep the poll
		* alive for exactly as long as a surface is mounted.
		*
		* Kept apart from `panel-view.tsx` so the components stay render-only and the
		* subscription logic has one home.
		*
		* @module dsh-workbuddy-connect/client/panel-hooks
		*/
		/**
		* Run `start` once for the mount, disposing on unmount.
		*
		* The panel's poll is started by the sidebar card (always mounted) rather than
		* by the dashboard, and `start()` is idempotent per store — so opening the
		* dashboard does not start a second timer, and closing it does not stop the
		* card's.
		*/
		function useEffectOnce(start) {
			(0, react.useEffect)(() => start(), [start]);
		}
		//#endregion
		//#region src/client/panel-view.tsx
		/**
		* The panel's view. `useWorkBuddyPanel` subscribes to the shared store, so a
		* completed sweep re-renders BOTH surfaces from the same snapshot — the footer
		* card's totals and the dashboard can never disagree about what was read.
		*/
		function usePanelView(props) {
			return buildPanelView({ snapshot: props.useWorkBuddyPanel((state) => state) });
		}
		/** Resolve the translator once per render from the injected locale seat. */
		function translatorOf(props) {
			return panelTranslator(props.t);
		}
		/** One small glyph: a filled dot whose colour follows the product's state. */
		function stateClass(product) {
			if (product.state === "signed-in") return "wbp-state wbp-stateOk";
			if (product.state === "error") return "wbp-state wbp-stateError";
			if (product.state === "signed-out") return "wbp-state wbp-stateWarn";
			return "wbp-state";
		}
		/** One labelled figure. */
		function StatTile({ label, value, pending, t }) {
			const empty = value === "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wbp-stat",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wbp-statLabel",
					children: t(label)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: empty ? "wbp-statValue wbp-statValueEmpty" : "wbp-statValue",
					children: empty ? pending === void 0 ? "" : t(pending) : value
				})]
			});
		}
		/** The figures shared by both surfaces for one product. */
		function statValue(product, label) {
			return product.stats.find((stat) => stat.label === label)?.value ?? "";
		}
		/** The pending key of one product's credit figure, when it has none. */
		function statPending(product, label) {
			return product.stats.find((stat) => stat.label === label)?.pending;
		}
		/** One product's full block on the dashboard. */
		function ProductCard({ product, t }) {
			const stateText = product.state === "signed-in" ? t("signedIn") : product.state === "signed-out" ? t("signedOut") : product.state === "error" ? t("failure") : t("loading");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "wbp-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wbp-cardHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-cardName",
								children: product.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: stateClass(product),
								children: stateText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wbp-spacer" }),
							product.benched > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-state wbp-stateWarn",
								children: t("benched", { count: product.benched })
							}) : null,
							product.catalogSource === "none" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-state",
								children: t(product.catalogSource === "live" ? "sourceLive" : product.catalogSource === "saved" ? "sourceSaved" : "sourceFallback")
							})
						]
					}),
					product.detail === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "wbp-detail",
						children: product.detail
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wbp-stats",
						children: product.stats.map((stat) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatTile, {
							label: stat.label,
							value: stat.value,
							pending: stat.pending,
							t
						}, stat.label))
					})
				]
			});
		}
		/**
		* The centre-column dashboard, registered into the layout's keyed `main` slot
		* under `workbuddy-panel`. Selecting that key is what the footer card's
		* `open()` does, so the two registrations are one navigation entry.
		*
		* The panel covers the Conversation while it is open, which is why it carries
		* its own way back (`close`): without one the footer card could only re-select
		* a panel the user is already looking at.
		*/
		function WorkBuddyPanel(props) {
			const view = usePanelView(props);
			const t = translatorOf(props);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wbp-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "wbp-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: "wbp-title",
								children: t("nav")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wbp-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wbp-headActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wbp-button",
									onClick: () => {
										props.refresh();
									},
									children: t("refresh")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wbp-button",
									onClick: () => {
										props.close();
									},
									children: t("close")
								})]
							})
						]
					}),
					!view.available && !view.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wbp-notice",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "wbp-hint",
							children: t("unavailable")
						})
					}) : null,
					view.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "wbp-hint",
						children: t("loading")
					}) : null,
					view.available ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wbp-summary",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "wbp-chip",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("accounts") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wbp-chipValue wbp-num",
									children: view.accountCount
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "wbp-chip",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("models") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wbp-chipValue wbp-num",
									children: view.modelCount
								})]
							}),
							view.benchedCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "wbp-chip",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wbp-chipValue wbp-num",
									children: view.benchedCount
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("benched", { count: view.benchedCount }) })]
							}) : null
						]
					}) : null,
					view.products.map((product) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProductCard, {
						product,
						t
					}, product.id))
				]
			});
		}
		/**
		* The sidebar footer card, registered into `sidebar.footer.action` — the list
		* the shell renders in the sidebar's foot area directly ABOVE the Settings
		* seat, so the card reads as a bottom-pinned sibling of Settings rather than a
		* global panel icon at the top of the column.
		*
		* The shell wraps nothing here, so this component owns the surface: the button,
		* its chrome and its accessible name. In the expanded column it draws the title
		* row and one line per product (accounts, total credit, models) — the two
		* products are never merged into one figure, because their credits are not
		* convertible. In the 56px rail it collapses to a 36px icon button, matching the
		* shell's own rail geometry. `wide` arrives from the shell as an owner prop.
		*
		* The poll starts here rather than in the panel: the card is always mounted, so
		* the dashboard opens with data already in hand.
		*/
		function WorkBuddyFooterEntry(props) {
			const view = usePanelView(props);
			const t = translatorOf(props);
			const startAutoRefresh = props.startAutoRefresh;
			const refresh = props.refresh;
			useEffectOnce(startAutoRefresh);
			if (!props.wide) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "wbp-railButton",
				"aria-label": t("railLabel"),
				title: view.footTitle === "" ? t("footerLabel") : view.footTitle,
				onClick: () => {
					props.open();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Glyph, { size: 18 })
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "wbp-foot",
				"aria-label": view.footTitle === "" ? t("footerLabel") : view.footTitle,
				title: view.footTitle === "" ? t("footerLabel") : view.footTitle,
				onClick: () => {
					props.open();
				},
				onDoubleClick: () => {
					refresh();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "wbp-footTop",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Glyph, { size: 16 }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wbp-footName",
							children: t("nav")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wbp-spacer" })
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wbp-footLines",
					children: view.products.map((product) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "wbp-footLine",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-footLineLabel",
								children: product.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wbp-spacer" }),
							product.state === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-num",
								children: statValue(product, "accountCount")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-num",
								children: statValue(product, "creditTotal") === "" ? t(statPending(product, "creditTotal") ?? "creditPending") : statValue(product, "creditTotal")
							})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: product.state === "signed-out" ? t("signedOut") : t("failure") })
						]
					}, product.id))
				})]
			});
		}
		/**
		* A 20×20 mark for the rail button. A glyph rather than an icon dependency:
		* the panel needs exactly one, and a package import would be a second client
		* module the browser has to resolve for one shape.
		*/
		function Glyph({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "wbp-glyph",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: "0 0 20 20",
					width: size,
					height: size,
					focusable: "false",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10",
						cy: "10",
						r: "7.25",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5",
						opacity: "0.45"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6.4 10.2 L9 12.8 L13.8 7.4",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "2",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					})]
				})
			});
		}
		/** Notify every subscriber without letting one faulty consumer suppress the rest. */
		function notify(listeners) {
			for (const listener of listeners) try {
				listener();
			} catch (error) {
				console.error("[dsh-workbuddy-connect] panel subscriber failed:", error);
			}
		}
		/**
		* Create the shared panel store.
		*
		* A failed read leaves that variant's previous document in place rather than
		* clearing it: a transient network error must not blank a dashboard the user is
		* looking at, and the next sweep replaces it anyway.
		*/
		function createWorkBuddyPanelStore(options = {}) {
			const variants = options.variants ?? CARD_VARIANTS;
			const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
			const intervalMs = options.intervalMs ?? 6e4;
			const now = options.now ?? (() => Date.now());
			let snapshot = {
				statuses: {},
				loading: false,
				fetchedAt: 0
			};
			const listeners = /* @__PURE__ */ new Set();
			let inFlight;
			let timer;
			const publish = (next) => {
				if (Object.is(next.statuses, snapshot.statuses) && next.loading === snapshot.loading && next.fetchedAt === snapshot.fetchedAt) return;
				snapshot = next;
				notify(listeners);
			};
			const sweep = async () => {
				publish({
					...snapshot,
					loading: true
				});
				const answers = await Promise.all(variants.map(async (variant) => {
					try {
						const response = await doFetch(variant.statusPath, {
							headers: { accept: "application/json" },
							credentials: "same-origin"
						});
						if (!response.ok) return void 0;
						const value = await response.json().catch(() => void 0);
						return isWorkBuddyWebStatus(value) ? [variant.id, value] : void 0;
					} catch {
						return;
					}
				}));
				const statuses = { ...snapshot.statuses };
				for (const answer of answers) if (answer !== void 0) statuses[answer[0]] = answer[1];
				publish({
					statuses,
					loading: false,
					fetchedAt: now()
				});
			};
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				refresh() {
					if (inFlight !== void 0) return inFlight;
					inFlight = sweep().finally(() => {
						inFlight = void 0;
					});
					return inFlight;
				},
				start() {
					if (timer !== void 0) return () => {
						if (timer === void 0) return;
						clearInterval(timer);
						timer = void 0;
					};
					this.refresh();
					timer = setInterval(() => {
						this.refresh();
					}, intervalMs);
					timer.unref?.();
					return () => {
						if (timer === void 0) return;
						clearInterval(timer);
						timer = void 0;
					};
				}
			};
		}
		//#endregion
		//#region src/client/panel-styles.ts
		/**
		* Stylesheet for the WorkBuddy dashboard: the sidebar footer card and the
		* centre-column panel it opens.
		*
		* Injected once by the client entry under its own `data-plugin-css` id, so a
		* second surface asking for it is a no-op. Classes are `wbp-` prefixed to stay
		* clear of any other plugin's set.
		*
		* Every colour goes through a `--dsw-alias-*` token with a literal fallback, so
		* the panel follows the harness theme where those tokens exist and stays
		* readable where they do not.
		*
		* @module dsh-workbuddy-connect/client/panel-styles
		*/
		/** Idempotency key for the injected `<style>` tag. */
		const PANEL_CSS_ID = "dsh-workbuddy-connect-panel";
		const PANEL_CSS = `
.wbp-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wbp-foot:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)); }
.wbp-foot:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, #4c8dff); outline-offset: 1px; }

.wbp-footTop { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wbp-footName {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wbp-footLines { display: flex; flex-direction: column; gap: 3px; }
.wbp-footLine {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.wbp-footLineLabel { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-spacer { flex: 1 1 auto; }
.wbp-num { font-variant-numeric: tabular-nums; }

.wbp-railButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
}
.wbp-railButton:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12)); }
.wbp-railButton:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, #4c8dff); outline-offset: 1px; }

.wbp-glyph { display: inline-flex; flex: 0 0 auto; }

.wbp-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 20px 24px 28px;
  overflow: auto;
  color: var(--dsw-alias-label-primary, inherit);
}
.wbp-head { display: flex; align-items: center; gap: 10px; }
.wbp-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; }
.wbp-headActions { display: flex; align-items: center; gap: 8px; }

.wbp-button {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.wbp-button:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)); }
.wbp-button:disabled { opacity: 0.5; cursor: default; }

.wbp-summary { display: flex; flex-wrap: wrap; gap: 8px; }
.wbp-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.2));
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.wbp-chipValue { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, inherit); font-weight: 600; }

.wbp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, transparent);
}
.wbp-cardHead { display: flex; align-items: center; gap: 8px; }
.wbp-cardName { font-size: 14px; line-height: 20px; font-weight: 600; }
.wbp-state {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, inherit);
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14));
}
.wbp-stateOk { color: var(--dsw-alias-state-success-primary, #22a06b); }
.wbp-stateWarn { color: var(--dsw-alias-state-warning-primary, #b45309); }
.wbp-stateError { color: var(--dsw-alias-state-error-primary, #d92d20); }

.wbp-detail { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: currentColor; }

.wbp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.wbp-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.18));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.wbp-statLabel { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-statValue { font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wbp-statValueEmpty { color: var(--dsw-alias-label-dimmed, #9aa0a6); }

.wbp-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbp-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, transparent);
}
.wbp-noticeError { border-color: var(--dsw-alias-state-error-primary, #d92d20); }
`;
		//#endregion
		//#region src/client/locales.ts
		const en = {
			title: "DSH WorkBuddy Connect",
			intro: "Use the models in the WorkBuddy desktop app directly in DSH — zero configuration, ready out of the box.",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "Use the models in the WorkBuddy AI international desktop app directly in DSH — zero configuration, ready out of the box.",
			expand: "Expand",
			collapse: "Collapse",
			loading: "Loading account…",
			signedOut: "Not signed in",
			signedOutHint: "Sign in once in the WorkBuddy desktop app; this plugin follows that sign-in automatically.",
			signedOutHintAI: "Sign in once in the WorkBuddy AI desktop app; this plugin follows that sign-in automatically.",
			signedInAs: "Signed in as {nickname}",
			accessTokenExpires: "Access token expires {time} (refresh is automatic)",
			creditsHeading: "Remaining credit",
			tabStatus: "Status",
			tabContext: "Context window",
			tabDetails: "Credit details",
			creditsDetailHeading: "By package",
			creditsTotal: "Total: {total}",
			creditsTotalUnlimited: "Total: Unlimited",
			unlimitedQuota: "Unlimited",
			packageEnterprise: "Enterprise quota",
			cycleResetAt: "Resets {time}",
			percentRemaining: "{percent}% remaining",
			percentUnknown: "Remaining share unknown",
			exactRemaining: "{remain} / {size} remaining",
			creditPackageUnknownSize: "{remain} remaining",
			creditsError: "Credit unavailable: {message}",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			refreshModels: "Refresh model list",
			refreshingModels: "Refreshing models…",
			catalogLive: "Model list updated {time}",
			catalogSaved: "Showing the saved model list from {time}",
			catalogFallback: "Showing the built-in model list (not yet updated from WorkBuddy)",
			catalogError: "Last update failed: {message}",
			catalogAppVersion: "App version {version}",
			requestFailed: "Request failed",
			statusRefreshFailed: "Refresh failed: {message} — showing the last known state",
			statusResponseInvalid: "WorkBuddy returned an unreadable status reply",
			accountHeading: "Account",
			modelsOffersHeading: "Model offers",
			contextHeading: "Context window",
			contextUpTo: "up to {size}",
			contextDefault: "default {size}",
			contextUnknown: "no declared context window",
			useMaximumContextWindow: "Use the largest declared context window",
			useMaximumContextWindowHint: "Applies to WorkBuddy AI models that offer a larger window.",
			visibilityIntro: "Uncheck a model to hide it from the model picker. Saved per signed-in account; chats already using a hidden model keep working.",
			visibilityStaleAccount: "The signed-in account changed — this change was not saved.",
			freeModel: "Free",
			rate: "{rate} credits per message",
			rateUnknown: "Price unavailable — refresh to update",
			probeLabel: "Reasoning levels",
			probeTooltipIdle: "Detect the reasoning levels {model} accepts",
			probeTooltipVerified: "Accepted levels: {levels} · click to detect again",
			probeTooltipNotValidating: "This model does not check the effort parameter",
			probeTooltipRetry: "Detection did not complete · click to retry",
			probeBubbleBody: "Send test requests to confirm the available reasoning levels. May consume a small amount of credit.",
			probeConfirmAction: "Confirm",
			probeNoteVerified: "Detected: {levels}",
			probeNoteNotValidating: "This model does not check the effort parameter",
			probeNoteUnknown: "Detection did not complete",
			probeNoteDismiss: "Got it",
			probeHeading: "Reasoning effort detection",
			probeResultNoLevels: "No tested levels were accepted.",
			probeIntro: "Some models reason but declare no selectable effort levels. Detecting which levels a model accepts sends a few real requests that may consume credit.",
			probeConsentHint: "Each detection sends test requests to one model to confirm its available reasoning levels, and may consume a small amount of credit.",
			probeStart: "Detect",
			probeRedetect: "Detect again",
			probeRunning: "Detecting {model}…",
			probeRunningGeneric: "Detecting…",
			probeClear: "Clear detected results",
			probeCandidates: "Detectable models: {count}",
			probeConfirmBody: "Send test requests to {model} to confirm its available reasoning levels. May consume a small amount of credit.",
			cancel: "Cancel",
			probeResultVerified: "Verified levels: {levels}",
			probeResultNotValidating: "This model does not check the effort parameter",
			probeResultUnknown: "Detection did not complete",
			probeResultAt: "Detected {time}",
			probeResultEmpty: "No detectable models right now.",
			probeFailed: "Detection failed: {message}",
			badgeLimitedFree: "Free for a limited time",
			badgeNightDiscount: "Off-peak discount",
			badgeFreeNow: "Free now",
			tabAccounts: "Accounts",
			accountAdd: "Add account",
			accountAddTitle: "Add an account",
			accountAddBody: "Open the mobile app, sign in, and scan this code. The account is added to the plugin only — it does not change the desktop app's sign-in.",
			accountAddWaiting: "Waiting for the scan… ({seconds}s left)",
			accountCheckNow: "Check now",
			accountChecking: "Checking…",
			accountQrExpired: "This code expired. Close the dialog and start again.",
			accountQrInvalid: "This sign-in is no longer valid. Start again.",
			accountEmpty: "No accounts yet. Sign in to the desktop app, or add one by QR.",
			accountUnavailable: "The host did not report its account pool. Update the plugin, or restart DSH.",
			navWorkBuddy: "DSH-WorkBuddy",
			accountPageTitle: "Accounts and credit",
			accountAddCn: "Add WorkBuddy account",
			accountAddPickHint: "Which product is this account for?",
			accountAddAi: "Add WorkBuddy AI account",
			accountLoginQr: "Scan to sign in",
			accountLoginWeb: "Sign in on the web",
			accountLoginToken: "Sign-in token",
			accountActionLogin: "Add account",
			accountTotalCredits: "Total credit",
			accountTokenBody: "Paste the sign-in token from the WorkBuddy web console. It is stored on this machine only, and it cannot renew itself — when it expires you paste a new one.",
			accountTokenPlaceholder: "Paste the token here (it starts with eyJ…)",
			accountSubmit: "Add",
			accountOpenLink: "Open sign-in page",
			accountWebBody: "Sign in on the page that just opened in your browser; the account is added here automatically as soon as it is done.",
			accountWebWaiting: "Waiting for the sign-in to finish… ({seconds}s left)",
			accountExpired: "Sign-in expired",
			modelsHeading: "Models",
			modelsRefresh: "Refresh list",
			modelsCount: "{count} models",
			contextLabel: "Context length",
			contextSwitchTitle: "Run this model at {size}",
			modelsEmpty: "No models yet. Refresh the list, or check the account above.",
			modelsSourceLive: "Updated {time}",
			modelsSourceSaved: "Saved list from {time}",
			modelsSourceFallback: "Built-in list",
			accountRotateHint: "Requests rotate between these accounts; one that answers \"too many requests\" is set aside for a while and tried again later.",
			accountRefreshCredits: "Refresh balances",
			accountTest: "Test",
			accountEnable: "Enable",
			accountDisable: "Disable",
			accountRename: "Rename",
			accountRemove: "Remove",
			accountRemoveConfirm: "Remove {name}? Its stored sign-in is deleted and cannot be recovered without scanning again.",
			accountCredits: "Credits {total}",
			accountCreditsPending: "Credits —",
			accountOriginDesktop: "From the desktop app",
			accountOriginQr: "Added by QR",
			accountTokenExpires: "Token expires {time}",
			accountTokenUnknown: "Token expiry unknown",
			accountStateDisabled: "Off",
			accountStateLimited: "rate limited",
			accountStateExhausted: "out of quota",
			accountStateSessionDead: "sign-in expired",
			accountStateWaiting: "{reason} · retry in {when}",
			waitMinutes: "{value} min",
			waitHours: "{value} h",
			accountAdded: "Added {name}",
			accountUpdated: "That account was already here; its sign-in was refreshed.",
			accountTestOk: "Connected",
			accountTestFailed: "Test failed",
			floatingTitle: "Accounts",
			floatingCollapse: "Hide",
			floatingExpand: "Show",
			floatingNoAccount: "No account",
			floatingRetryIn: "retry {when}",
			floatingSettingLabel: "Floating account window",
			floatingSettingHint: "Show each account and its remaining balance over the conversation.",
			assistantHeading: "Let an Agent sort this out",
			assistantIntro: "Send the request below to your Agent; it will check the app location and the launch configuration for you.",
			assistantCopy: "Copy for Agent",
			assistantCopied: "Copied",
			assistantCopyFailed: "Copy failed — select the text above and copy it manually",
			assistantAfter: "When your Agent is done, come back and check again. If the DSH launch environment was changed, restart DSH first as instructed.",
			assistantRecheck: "Done — check again",
			assistantRechecking: "Checking…",
			assistantPrompt: "DSH's dsh-workbuddy-connect cannot use my {appName}: {failureSummary}. Please check the actual installation location and any existing path configuration, help the plugin use it correctly, and verify recovery. If the DSH launch environment must be changed or DSH restarted, give me clear steps; do not only set an environment variable temporarily in the current shell.",
			assistNotFound: "no usable decryption program was found",
			assistAmbiguous: "more than one WorkBuddy copy was found and none could be chosen safely",
			assistIncomplete: "the automatic search could not be completed",
			assistPathInvalid: "the configured program path is not usable",
			assistUnavailableCN: "no decryption program is configured for this platform",
			assistUnavailableAI: "no decryption program is configured for WorkBuddy AI"
		};
		const zh = {
			title: "DSH WorkBuddy Connect",
			intro: "在 DSH 中直接使用 WorkBuddy 桌面 App 包含的模型，开箱即用，无需额外配置。",
			titleAI: "DSH WorkBuddy AI Connect",
			introAI: "在 DSH 中直接使用 WorkBuddy AI 国际版桌面 App 包含的模型，开箱即用，无需额外配置。",
			expand: "展开",
			collapse: "收起",
			loading: "正在读取账号…",
			signedOut: "未登录",
			signedOutHint: "在 WorkBuddy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedOutHintAI: "在 WorkBuddy AI 国际版桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			signedInAs: "已登录：{nickname}",
			accessTokenExpires: "访问令牌 {time} 过期（自动续期）",
			creditsHeading: "剩余积分",
			tabStatus: "状态",
			tabContext: "上下文窗口",
			tabDetails: "积分详情",
			creditsDetailHeading: "按套餐",
			creditsTotal: "合计：{total}",
			creditsTotalUnlimited: "合计：不限额",
			unlimitedQuota: "不限额",
			packageEnterprise: "企业额度",
			cycleResetAt: "重置时间：{time}",
			percentRemaining: "剩余 {percent}%",
			percentUnknown: "剩余占比未知",
			exactRemaining: "剩余 {remain} / {size}",
			creditPackageUnknownSize: "剩余 {remain}",
			creditsError: "积分查询失败：{message}",
			refresh: "刷新",
			refreshing: "正在刷新…",
			refreshModels: "刷新模型列表",
			refreshingModels: "正在刷新模型…",
			catalogLive: "模型列表更新于 {time}",
			catalogSaved: "当前显示已保存的模型列表，更新于 {time}",
			catalogFallback: "当前显示内置模型列表（尚未从 WorkBuddy 更新）",
			catalogError: "上次更新失败：{message}",
			catalogAppVersion: "App 版本 {version}",
			requestFailed: "请求失败",
			statusRefreshFailed: "刷新失败：{message} — 当前显示的是上次成功获取的状态",
			statusResponseInvalid: "WorkBuddy 返回的状态数据无法识别",
			accountHeading: "账号",
			modelsOffersHeading: "模型优惠",
			contextHeading: "上下文窗口",
			contextUpTo: "最高 {size}",
			contextDefault: "默认 {size}",
			contextUnknown: "未声明上下文窗口",
			useMaximumContextWindow: "使用上游声明的最大上下文窗口",
			useMaximumContextWindowHint: "仅作用于 WorkBuddy AI 中声明了更大窗口的模型。",
			visibilityIntro: "取消勾选即可在模型选择器中隐藏该模型；按当前登录账号分别保存，已在用该模型的会话不受影响。",
			visibilityStaleAccount: "登录账号已切换——本次修改未保存。",
			freeModel: "免费",
			rate: "{rate} 积分/次",
			rateUnknown: "价格未知 — 刷新后更新",
			probeLabel: "推理等级",
			probeTooltipIdle: "检测 {model} 可用的推理档位",
			probeTooltipVerified: "已接受：{levels} · 点击可重新检测",
			probeTooltipNotValidating: "该模型不校验该参数",
			probeTooltipRetry: "检测未完成 · 点击重试",
			probeBubbleBody: "发送探测请求以确认可用推理档位。可能消耗少量积分。",
			probeConfirmAction: "确认检测",
			probeNoteVerified: "已检测：{levels}",
			probeNoteNotValidating: "该模型不校验该参数",
			probeNoteUnknown: "检测未完成",
			probeNoteDismiss: "知道了",
			probeHeading: "推理档位检测",
			probeResultNoLevels: "本次测试的档位均未被接受。",
			probeIntro: "部分模型具备思考能力，但没有声明可选档位。检测会发送少量真实请求，可能消耗积分。",
			probeConsentHint: "每次检测会向该模型发送探测请求，以确认可用推理档位，可能消耗少量积分。",
			probeStart: "开始检测",
			probeRedetect: "重新检测",
			probeRunning: "正在检测 {model}…",
			probeRunningGeneric: "正在检测…",
			probeClear: "清除已探测结果",
			probeCandidates: "可检测模型：{count} 个",
			probeConfirmBody: "向 {model} 发送探测请求，以确认可用推理档位。可能消耗少量积分。",
			cancel: "取消",
			probeResultVerified: "已验证接受的档位：{levels}",
			probeResultNotValidating: "该模型不校验该参数",
			probeResultUnknown: "检测未完成",
			probeResultAt: "检测于 {time}",
			probeResultEmpty: "当前没有可检测的模型。",
			probeFailed: "检测失败：{message}",
			badgeLimitedFree: "限时免费",
			badgeNightDiscount: "夜间折扣",
			badgeFreeNow: "限时免费",
			tabAccounts: "账号",
			accountAdd: "添加账号",
			accountAddTitle: "添加账号",
			accountAddBody: "打开手机 App 登录后扫描此二维码。账号只加入本插件，不会改变桌面 App 的登录状态。",
			accountAddWaiting: "等待扫码…（剩余 {seconds} 秒）",
			accountCheckNow: "立即检查",
			accountChecking: "检查中…",
			accountQrExpired: "二维码已过期，关闭后重新发起。",
			accountQrInvalid: "该登录已失效，请重新发起。",
			accountEmpty: "还没有账号。可在桌面 App 登录，或在此扫码添加。",
			accountUnavailable: "宿主未返回账号列表。请更新插件或重启 DSH。",
			navWorkBuddy: "DSH-WorkBuddy",
			accountPageTitle: "账号与积分",
			accountAddCn: "添加 WorkBuddy 账号",
			accountAddPickHint: "这个账号属于哪一版？",
			accountAddAi: "添加 WorkBuddy AI 账号",
			accountLoginQr: "扫码登录",
			accountLoginWeb: "网页登录",
			accountLoginToken: "Cookie 登录",
			accountActionLogin: "添加账号",
			accountTotalCredits: "总积分",
			accountTokenBody: "粘贴 WorkBuddy 网页控制台里的登录令牌。它只保存在本机，且无法自动续期 —— 过期后重新粘贴一份即可。",
			accountTokenPlaceholder: "在此粘贴令牌（以 eyJ 开头）",
			accountSubmit: "添加",
			accountOpenLink: "打开登录页面",
			accountWebBody: "在刚弹出的浏览器页面上完成登录即可，登录完成后账号会自动加入。",
			accountWebWaiting: "等待登录完成…（剩余 {seconds} 秒）",
			accountExpired: "登录已过期",
			modelsHeading: "模型列表",
			modelsRefresh: "刷新列表",
			modelsCount: "{count} 个模型",
			contextLabel: "上下文长度",
			contextSwitchTitle: "以 {size} 运行该模型",
			modelsEmpty: "暂无模型。可刷新列表，或检查上方账号。",
			modelsSourceLive: "更新于 {time}",
			modelsSourceSaved: "已保存的列表，更新于 {time}",
			modelsSourceFallback: "内置列表",
			accountRotateHint: "请求会在这些账号之间轮换；被上游限流的账号会暂时搁置，稍后自动重试。",
			accountRefreshCredits: "刷新积分",
			accountTest: "测试",
			accountEnable: "启用",
			accountDisable: "停用",
			accountRename: "重命名",
			accountRemove: "删除",
			accountRemoveConfirm: "确定删除 {name}？其保存的登录凭证会被清除，除非重新扫码否则无法恢复。",
			accountCredits: "积分 {total}",
			accountCreditsPending: "积分 —",
			accountOriginDesktop: "来自桌面 App",
			accountOriginQr: "扫码添加",
			accountTokenExpires: "令牌 {time} 过期",
			accountTokenUnknown: "令牌过期时间未知",
			accountStateDisabled: "已停用",
			accountStateLimited: "限流中",
			accountStateExhausted: "额度耗尽",
			accountStateSessionDead: "登录失效",
			accountStateWaiting: "{reason} · {when}后重试",
			waitMinutes: "{value} 分钟",
			waitHours: "{value} 小时",
			accountAdded: "已添加 {name}",
			accountUpdated: "该账号已存在，已更新其登录凭证。",
			accountTestOk: "连通正常",
			accountTestFailed: "测试失败",
			floatingTitle: "账号",
			floatingCollapse: "收起",
			floatingExpand: "展开",
			floatingNoAccount: "暂无账号",
			floatingRetryIn: "{when}后重试",
			floatingSettingLabel: "悬浮账号窗",
			floatingSettingHint: "在对话内容右上角显示各账号及其剩余积分。",
			assistantHeading: "让 Agent 帮你处理",
			assistantIntro: "把下面这段请求发给你的 Agent，它会协助检查应用位置和启动配置。",
			assistantCopy: "复制给 Agent",
			assistantCopied: "已复制",
			assistantCopyFailed: "复制失败，请手动选择上方文字复制",
			assistantAfter: "Agent 处理完成后，回到这里重新检查；如果修改了 DSH 的启动环境，请先按指引重启 DSH。",
			assistantRecheck: "已处理，重新检查",
			assistantRechecking: "正在检查…",
			assistantPrompt: "DSH 的 dsh-workbuddy-connect 无法使用我的 {appName}：{failureSummary}。请帮我检查实际安装位置和已有路径配置，让插件能正确使用它，并验证恢复结果；如果需要修改 DSH 的启动环境或重启，请给我明确的操作步骤，不要只在当前 shell 临时设置环境变量。",
			assistNotFound: "没有找到可用的解密程序",
			assistAmbiguous: "找到了多个 WorkBuddy 副本，无法安全自动选择",
			assistIncomplete: "自动定位未能完成",
			assistPathInvalid: "指定的程序路径不可用",
			assistUnavailableCN: "当前平台尚未配置解密程序",
			assistUnavailableAI: "尚未配置 WorkBuddy AI 的解密程序"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-connect-client";
		/**
		* Client services required by this browser half.
		*
		* DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
		* hold the browser `ClientContext` alias and the `slots` service), so the
		* services come from narrower packages: the `slots` registry lives in
		* `@deepseek-ai/dsh-client-ui-renderer` and `locale` in
		* `@deepseek-ai/dsh-client-locale`. None of the SEAT OWNERS is named here:
		* `sidebar.footer.action`, `main` and `settings.section` are declared by three
		* different packages, and the seam each host actually ships is discovered by
		* slot-declaration lifetime rather than by activation order — a static inject
		* would park this fiber on a package some profiles never mount.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.session"
		];
		/** Prefix every guarded client contribution's degradation logs with this. */
		const CLIENT_CONTRIBUTION_FAILED = "[dsh-workbuddy-connect] client contribution failed to load (host provider unaffected):";
		/** Disposer handed back when a deferred registration degraded: nothing to undo. */
		const NOOP_DISPOSER = () => {};
		/**
		* The sidebar panel's id. It is the layout's `MainPanelId`: one string shared
		* by the `sidebar.footer.action` card and the `main` slot cell, so the card
		* selects this panel and nothing else.
		*/
		const PANEL_ID = "workbuddy-panel";
		/**
		* `ui-conversation`'s reserved `main` key, used only as the exit fallback for
		* a layout whose `selectPanel` predates the `null` "show the Conversation"
		* selection. Declared locally because `ui-conversation` is not a dependency of
		* this bundle and the key is a published contract of the layout.
		*/
		const CONVERSATION_PANEL_ID = "conversation";
		/** Inject the settings-page copy and resolve the translator bound to it. */
		function bindSettingsCopy(ctx, namespace) {
			return ctx.locale.bind(namespace);
		}
		/**
		* Inject the dashboard's stylesheet once and return its disposer, for
		* `ctx.effect` to own. Keyed by its own `data-plugin-css` id, so the injection
		* is idempotent even if a second surface asks for it later.
		*/
		function injectPanelCss() {
			if (typeof document === "undefined") return NOOP_DISPOSER;
			if (document.querySelector(`style[data-plugin-css="dsh-workbuddy-connect-panel"]`) !== null) return NOOP_DISPOSER;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workbuddy-connect";
			tag.dataset.pluginCss = PANEL_CSS_ID;
			tag.textContent = PANEL_CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		/**
		* Run ONE browser-side contribution, degrading its failure to a `console.error`
		* instead of throwing into the DSH loader. Returns the contribution's own value
		* on success, or `undefined` when it degraded — the deferred slot callbacks
		* below substitute `NOOP_DISPOSER` for that, because the slot runtime always
		* expects a disposer back.
		*
		* Every contribution is guarded at BOTH boundaries where it can throw:
		*
		* 1. the eager `ctx.slots.inject(...)` / `ctx.inject(...)` call itself, which
		*    runs synchronously inside `apply()` — e.g. a slot-API shape break such as
		*    the rc.6→rc.7 `id`→`key` rename;
		* 2. the deferred callback, which the slot runtime invokes later — when the
		*    owner commits the slot's declaration, or when the injected services
		*    arrive — long after `apply()` has returned, where no enclosing try/catch
		*    could still catch it.
		*
		* The pair is what makes the contributions independent: a failure in one
		* surface leaves every other registration intact. Guards are for THIS browser
		* half only; the host half reports its own errors through `ctx.logger`.
		*/
		function guardClientContribution(label, fn) {
			try {
				return fn();
			} catch (error) {
				console.error(`${CLIENT_CONTRIBUTION_FAILED} ${label}`, error);
				return;
			}
		}
		/**
		* Register the copy namespaces, the dashboard, and the conversation-side
		* surfaces, one guarded contribution at a time.
		*
		* The host provider keeps working throughout: the `workbuddy` model channel is
		* unaffected, and `dsh-workbuddy-connect status` reports host health via the
		* heartbeat file.
		*/
		function apply(ctx) {
			const namespace = "settings.workbuddy";
			guardClientContribution("settings copy", () => {
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-workbuddy-connect: settings copy");
			});
			const t = bindSettingsCopy(ctx, namespace);
			guardClientContribution("panel copy", () => {
				ctx.effect(() => ctx.locale.register(PANEL_LOCALE_NS, {
					zh: PANEL_COPY_ZH,
					en: PANEL_COPY_EN
				}), "dsh-workbuddy-connect: panel copy");
			});
			const panelStore = createWorkBuddyPanelStore();
			/**
			* The injected face both panel slots carry. `layout` is read reflectively AT
			* CLICK TIME, never captured at setup: ui-layout is not a dependency of this
			* bundle, so a static `inject` would park the whole client fiber.
			*/
			const panelFace = () => ({
				hooks: { workBuddyPanel: panelStore },
				refresh: () => {
					panelStore.refresh();
				},
				startAutoRefresh: () => panelStore.start(),
				open: () => {
					const layout = ctx.get("layout");
					if (typeof layout?.selectPanel === "function") layout.selectPanel(PANEL_ID);
				},
				close: () => {
					const layout = ctx.get("layout");
					if (typeof layout?.selectPanel !== "function") return;
					try {
						layout.selectPanel(null);
					} catch {
						try {
							layout.selectPanel(CONVERSATION_PANEL_ID);
						} catch (error) {
							console.error("[dsh-workbuddy-connect] could not close the dashboard:", error);
						}
					}
				}
			});
			guardClientContribution("panel styles", () => {
				ctx.effect(() => injectPanelCss(), "dsh-workbuddy-connect: panel styles");
			});
			guardClientContribution("dashboard panel", () => {
				ctx.slots.inject("main", () => guardClientContribution("dashboard panel", () => ctx.slots.register({
					name: "main",
					key: "workbuddy-panel",
					locale: "panel.workbuddy",
					inject: panelFace
				}, WorkBuddyPanel)) ?? NOOP_DISPOSER);
			});
			guardClientContribution("sidebar footer card", () => {
				ctx.inject(["layout"], (layoutCtx) => {
					if (typeof layoutCtx.get("layout")?.selectPanel !== "function") return;
					guardClientContribution("sidebar footer card", () => layoutCtx.slots.inject("sidebar.footer.action", () => guardClientContribution("sidebar footer card", () => layoutCtx.slots.register({
						name: "sidebar.footer.action",
						id: "workbuddy-panel",
						order: 1,
						locale: "panel.workbuddy",
						inject: panelFace
					}, WorkBuddyFooterEntry)) ?? NOOP_DISPOSER));
				});
			});
			guardClientContribution("settings section", () => {
				ctx.slots.inject("settings.section", () => guardClientContribution("settings section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-workbuddy",
					order: 40,
					label: () => t("navWorkBuddy"),
					locale: namespace,
					inject: () => ({ t })
				}, WorkBuddySettingsPage)) ?? NOOP_DISPOSER);
			});
			guardClientContribution("floating account window", () => {
				ctx.slots.inject("conversation.session.header.utilities", () => guardClientContribution("floating account window", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "workbuddy-floating-accounts",
					order: 90,
					inject: () => ({ t })
				}, WorkBuddyFloatingAccounts)) ?? NOOP_DISPOSER);
			});
			guardClientContribution("conversation probe control", () => {
				ctx.inject(["modelDirectories"], (scope) => {
					guardClientContribution("conversation probe control", () => {
						scope.slots.inject("conversation.input.right", () => guardClientContribution("conversation probe control", () => scope.slots.register({
							name: "conversation.input.right",
							id: "workbuddy-probe",
							order: 10,
							inject: (sessionId) => ({
								directory: scope.modelDirectories.directoryFor(sessionId).store,
								t
							})
						}, WorkBuddyProbeControl)) ?? NOOP_DISPOSER);
					});
				});
			});
		}
		//#endregion
		exports.CARD_VARIANTS = CARD_VARIANTS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
