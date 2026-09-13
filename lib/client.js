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
		/** Plugin-owned status endpoint consumed by its browser half. */
		const WORKBUDDY_STATUS_PATH = "/plugins/dsh-workbuddy-connect/status";
		/**
		* Plugin-owned probe control endpoint.
		*
		* Separate from the status route because it accepts writes: the status route's
		* loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
		* not the same as authorizing a state-changing action. This route therefore
		* also requires the in-process key the browser half receives with the status
		* document.
		*/
		const WORKBUDDY_PROBE_PATH = "/plugins/dsh-workbuddy-connect/probe";
		/**
		* The international (WorkBuddy AI) variant's own pair of routes.
		*
		* Kept as separate constants rather than a computed suffix so both halves
		* reference literal strings: the browser bundle and the host bundle are built
		* independently, and a shared expression is one build-config drift away from
		* the desk asking a route the host never mounted.
		*/
		const WORKBUDDY_AI_STATUS_PATH = "/plugins/dsh-workbuddy-connect/ai/status";
		const WORKBUDDY_AI_PROBE_PATH = "/plugins/dsh-workbuddy-connect/ai/probe";
		/**
		* Account-management routes, one pair per variant.
		*
		* Separate from the probe route because they act on different state (the
		* account pool, not probe records) and because a browser that fails to reach
		* one must not lose the other. Both are writes and therefore carry the same
		* in-process key as the probe route.
		*/
		const WORKBUDDY_ACCOUNT_PATH = "/plugins/dsh-workbuddy-connect/accounts";
		const WORKBUDDY_AI_ACCOUNT_PATH = "/plugins/dsh-workbuddy-connect/ai/accounts";
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
		//#region src/client/WorkBuddyAccountsTab.tsx
		/**
		* The card's account tab: the pool, and every action that changes it.
		*
		* Shape of the surface:
		* - a list of pooled accounts, each one row: name (editable), origin, balance,
		*   state (可用 / 限流中 / 额度耗尽 / 会话失效), and its own controls;
		* - one primary action, 「扫码添加账号」, which opens the QR dialog;
		* - one secondary action, 「刷新积分」, which re-reads every balance.
		*
		* The dialog is a portal on \`document.body\` rather than an in-flow panel. The
		* card lives inside the settings page's own scroll container, and an in-flow
		* panel either stretches that container or gets clipped by it; a portal keeps
		* the QR code fully visible regardless of where the card sits.
		*
		* @module dsh-workbuddy-connect/client/accounts-tab
		*/
		/** How often the dialog asks whether the scan has landed. */
		const POLL_INTERVAL_MS$2 = 2e3;
		const listStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const rowCardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const rowTopStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 10,
			flexWrap: "wrap"
		};
		const rowNameStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			minWidth: 0,
			fontSize: 14,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const rowMetaStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const rowActionsStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const smallButtonStyle = {
			boxSizing: "border-box",
			minHeight: 28,
			padding: "3px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer"
		};
		const dangerButtonStyle = {
			...smallButtonStyle,
			color: "var(--dsw-alias-state-error-primary, #d92d20)"
		};
		const primaryButtonStyle$2 = {
			boxSizing: "border-box",
			minHeight: 34,
			padding: "6px 14px",
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			borderRadius: 18,
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		const chipBaseStyle = {
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			whiteSpace: "nowrap"
		};
		const labelInputStyle = {
			boxSizing: "border-box",
			minWidth: 120,
			flex: "1 1 120px",
			padding: "4px 8px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "var(--dsw-alias-bg-module-platform)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 13
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
			width: "min(380px, 100%)",
			maxHeight: "100%",
			overflowY: "auto",
			padding: "18px 18px 16px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)"
		};
		const dialogTitleStyle = {
			margin: 0,
			fontSize: 16,
			lineHeight: "24px",
			fontWeight: 600
		};
		const dialogBodyStyle = {
			margin: 0,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const qrFrameStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 12,
			borderRadius: 8,
			background: "#fff"
		};
		const dialogActionsStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		/**
		* Render a QR symbol into a canvas.
		*
		* Scaled to a whole number of device pixels per module: a fractional scale
		* blurs the module edges, and a blurred edge is exactly what makes a camera
		* struggle to lock on.
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
		/** The cooldown/state chip, which is the row's most important fact. */
		function stateChip(account, t, now) {
			if (account.sessionDead === true) return {
				text: t("accountStateSessionDead"),
				style: {
					...chipBaseStyle,
					background: "rgba(217, 45, 32, 0.12)",
					color: "var(--dsw-alias-state-error-primary, #d92d20)"
				}
			};
			if (account.enabled !== true) return {
				text: t("accountStateDisabled"),
				style: {
					...chipBaseStyle,
					background: "var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.06))",
					color: "var(--dsw-alias-label-tertiary)"
				}
			};
			const cooldown = account.cooldown;
			if (cooldown !== void 0 && cooldown.untilMs > now) {
				const minutes = Math.max(1, Math.ceil((cooldown.untilMs - now) / 6e4));
				return {
					text: t("accountStateWaiting", {
						reason: t(cooldown.reason === "credit" ? "accountStateExhausted" : cooldown.reason === "session" ? "accountStateSessionDead" : "accountStateLimited"),
						minutes
					}),
					style: {
						...chipBaseStyle,
						background: "rgba(245, 158, 11, 0.14)",
						color: "var(--dsw-alias-state-warning-primary, #b45309)"
					}
				};
			}
		}
		/** One pooled account row. */
		function AccountRow({ account, busy, now, t, onAction }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(account.label ?? "");
			const chip = stateChip(account, t, now);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowCardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowTopStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: rowNameStyle,
						children: [editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							autoFocus: true,
							style: labelInputStyle,
							value: draft,
							placeholder: account.nickname ?? account.uid.slice(0, 8),
							onChange: (event) => {
								setDraft(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") {
									onAction({
										action: "label",
										id: account.id,
										label: draft
									});
									setEditing(false);
								}
								if (event.key === "Escape") {
									setDraft(account.label ?? "");
									setEditing(false);
								}
							},
							onBlur: () => {
								onAction({
									action: "label",
									id: account.id,
									label: draft
								});
								setEditing(false);
							}
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: account.name }), chip === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: chip.style,
							children: chip.text
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: rowActionsStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: smallButtonStyle,
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
								style: smallButtonStyle,
								disabled: busy,
								onClick: () => {
									onAction({
										action: "enable",
										id: account.id,
										enabled: account.enabled !== true
									});
								},
								children: t(account.enabled === true ? "accountDisable" : "accountEnable")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: smallButtonStyle,
								disabled: busy,
								onClick: () => {
									setEditing(true);
								},
								children: t("accountRename")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: dangerButtonStyle,
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
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: rowMetaStyle,
					children: [
						account.credits === void 0 ? account.creditsError === void 0 ? t("accountCreditsPending") : t("creditsError", { message: account.creditsError }) : t("accountCredits", { total: new Intl.NumberFormat(void 0).format(account.credits) }),
						" · ",
						t(account.origin === "desktop" ? "accountOriginDesktop" : "accountOriginQr"),
						account.sessionDead === true ? "" : ` · ${t("accountTokenExpires", { time: account.expiresAtMs > 0 ? new Intl.DateTimeFormat(void 0, {
							dateStyle: "short",
							timeStyle: "short"
						}).format(new Date(account.expiresAtMs)) : t("accountTokenUnknown") })}`
					]
				})]
			});
		}
		/** The scan-to-add dialog. */
		function QrDialog({ challenge, t, busy, error, onCancel, onCheck }) {
			const [remaining, setRemaining] = (0, react.useState)(() => Math.max(0, challenge.expiresAtMs - Date.now()));
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()));
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [challenge.expiresAtMs]);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [onCancel]);
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
							children: t("accountAddBody")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: qrFrameStyle,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QrCanvas, {
								text: challenge.authUrl,
								modulePixels: 240
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: dialogBodyStyle,
							children: t("accountAddWaiting", { seconds: Math.ceil(remaining / 1e3) })
						}),
						error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								...dialogBodyStyle,
								color: "var(--dsw-alias-state-error-primary, #d92d20)"
							},
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: dialogActionsStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: smallButtonStyle,
								onClick: onCancel,
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle$2,
								disabled: busy,
								onClick: onCheck,
								children: busy ? t("accountChecking") : t("accountCheckNow")
							})]
						})
					]
				})
			}), document.body);
		}
		function WorkBuddyAccountsTab({ accounts, accountPath, t, busy, run, refresh, notice, noticeIsError }) {
			const [challenge, setChallenge] = (0, react.useState)();
			const [dialogError, setDialogError] = (0, react.useState)();
			const [dialogBusy, setDialogBusy] = (0, react.useState)(false);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 3e4);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			/**
			* Poll a challenge until it lands, expires, or is cancelled.
			*
			* Kept as a ref-driven loop rather than an interval so a slow round trip
			* cannot stack requests, and so cancelling stops the chain immediately.
			*/
			const cancelled = (0, react.useRef)(false);
			const pollOnce = (0, react.useCallback)(async (state) => {
				setDialogBusy(true);
				try {
					const result = await run({
						action: "poll",
						state
					});
					if (result === void 0) {
						setDialogError(t("requestFailed"));
						return false;
					}
					switch (result.state) {
						case "waiting": return true;
						case "added":
							setChallenge(void 0);
							setDialogError(void 0);
							await refresh();
							return false;
						case "expired":
							setDialogError(t("accountQrExpired"));
							return false;
						case "invalid":
							setDialogError(t("accountQrInvalid"));
							return false;
						default:
							setDialogError(result.reason ?? t("requestFailed"));
							return false;
					}
				} finally {
					setDialogBusy(false);
				}
			}, [
				refresh,
				run,
				t
			]);
			(0, react.useEffect)(() => {
				if (challenge === void 0) return;
				cancelled.current = false;
				const timer = window.setInterval(() => {
					if (cancelled.current) return;
					pollOnce(challenge.state).then((keep) => {
						if (!keep) cancelled.current = true;
					});
				}, POLL_INTERVAL_MS$2);
				return () => {
					cancelled.current = true;
					window.clearInterval(timer);
				};
			}, [challenge, pollOnce]);
			const startAdd = (0, react.useCallback)(async () => {
				setDialogError(void 0);
				const result = await run({ action: "add" });
				if (result?.challenge === void 0) {
					setDialogError(result?.reason ?? t("requestFailed"));
					return;
				}
				setChallenge(result.challenge);
			}, [run, t]);
			const closeDialog = (0, react.useCallback)(() => {
				const state = challenge?.state;
				setChallenge(void 0);
				setDialogError(void 0);
				if (state !== void 0) run({
					action: "cancel",
					state
				});
			}, [challenge, run]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: listStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowTopStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: {
								margin: 0,
								fontSize: 14,
								lineHeight: "20px",
								fontWeight: 600
							},
							children: t("accountHeading")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: rowActionsStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle$2,
								disabled: busy,
								onClick: () => {
									startAdd();
								},
								children: t("accountAdd")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: smallButtonStyle,
								disabled: busy,
								onClick: () => {
									run({ action: "refresh-credits" }).then(() => refresh());
								},
								children: t("accountRefreshCredits")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: rowMetaStyle,
						children: t("accountRotateHint")
					}),
					accounts.accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: dialogBodyStyle,
						children: t("accountEmpty")
					}) : accounts.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountRow, {
						account,
						busy: busy || dialogBusy,
						now,
						t,
						onAction: (action) => {
							run(action).then(() => refresh());
						}
					}, account.id)),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...dialogBodyStyle,
							color: noticeIsError === true ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-state-success-primary, #22a06b)"
						},
						children: notice
					}),
					challenge === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QrDialog, {
						challenge,
						t,
						busy: dialogBusy,
						...dialogError === void 0 ? {} : { error: dialogError },
						onCancel: closeDialog,
						onCheck: () => {
							pollOnce(challenge.state);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyPluginCard.tsx
		/** WorkBuddy status card contributed to Harness Plugin configuration. */
		/** CN WorkBuddy; the plugin's long-standing card and default. */
		const CN_CARD_VARIANT = {
			id: "workbuddy",
			titleKey: "title",
			introKey: "intro",
			signedOutKey: "signedOutHint",
			statusPath: WORKBUDDY_STATUS_PATH,
			probePath: WORKBUDDY_PROBE_PATH,
			accountPath: WORKBUDDY_ACCOUNT_PATH
		};
		/** Both cards, in display order. */
		const CARD_VARIANTS = [CN_CARD_VARIANT, {
			id: "workbuddy-ai",
			titleKey: "titleAI",
			introKey: "introAI",
			signedOutKey: "signedOutHintAI",
			statusPath: WORKBUDDY_AI_STATUS_PATH,
			probePath: WORKBUDDY_AI_PROBE_PATH,
			accountPath: WORKBUDDY_AI_ACCOUNT_PATH
		}];
		const POLL_INTERVAL_MS$1 = 6e4;
		const cardStyle = {
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 10,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const headerStyle$1 = {
			boxSizing: "border-box",
			width: "100%",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 16,
			border: 0,
			padding: "13px 14px",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
		const headTextStyle = {
			display: "flex",
			minWidth: 0,
			flexDirection: "column",
			gap: 3
		};
		const nameStyle = {
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600
		};
		const descriptionStyle = {
			fontSize: 13,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const chevronStyle = {
			flex: "0 0 auto",
			fontSize: 18,
			lineHeight: 1,
			transition: "transform 120ms ease"
		};
		const cardBodyStyle = {
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			padding: "16px 14px 18px"
		};
		const bodyStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			flexWrap: "wrap",
			gap: 12
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			gap: 9,
			fontSize: 15,
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const buttonStyle$1 = {
			boxSizing: "border-box",
			minHeight: 34,
			padding: "6px 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		const errorStyle = {
			...bodyStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const quotaListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 2
		};
		const quotaGroupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const quotaTitleStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaLabelStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const modelBadgeStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const modelOfferStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		const modelRateStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const modelBadgeChipStyle = {
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			background: "var(--dsw-alias-state-success-subtle, rgba(34, 160, 107, 0.12))",
			color: "var(--dsw-alias-state-success-primary, #22a06b)"
		};
		/**
		* Localize an upstream promotional badge label, with an unknown-badge fallback.
		*
		* The CN catalog spells badges in Chinese (`限时免费`, `夜间折扣`); the
		* international document's `modelPromotions` carries English (`Free now`). Both
		* are mapped so the same promotion reads consistently in either UI language,
		* and anything else passes through verbatim — an unrecognized badge is still
		* information the upstream chose to show.
		*/
		function modelBadgeLabel(badge, t) {
			if (badge === "限时免费") return t("badgeLimitedFree");
			if (badge === "夜间折扣") return t("badgeNightDiscount");
			if (badge === "Free now") return t("badgeFreeNow");
			return badge;
		}
		const progressTrackStyle = {
			height: 8,
			overflow: "hidden",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))"
		};
		/**
		* Inline confirmation box for a paid detection. Replaces the previous
		* `window.confirm`: the decision is one line plus two buttons, and a modal
		* alert for that is heavier than the action it guards.
		*/
		const confirmBoxStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const confirmRowStyle$1 = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		/** One probeable model's row: name on the left, state and action on the right. */
		const probeRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		const probeRowEndStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			flex: "0 0 auto"
		};
		/**
		* Tab strip for the card body. Kept visually light — a full pill would compete
		* with the section headings, and the card is already the densest surface the
		* plugin owns.
		*/
		const tabBarStyle = {
			display: "flex",
			gap: 4,
			marginTop: 4,
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const tabStyle = {
			padding: "6px 12px",
			border: 0,
			borderBottom: "2px solid transparent",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: "20px",
			cursor: "pointer"
		};
		const tabActiveStyle = {
			borderBottom: "2px solid var(--dsw-alias-brand-primary)",
			color: "var(--dsw-alias-label-primary)",
			fontWeight: 600
		};
		const tabPanelStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 16
		};
		/**
		* Primary action of the inline confirmation. Fill and text colour come from the
		* theme as a pair: `brand-primary` is a light accent here, so pairing it with a
		* hardcoded white would render white-on-white.
		*/
		const primaryButtonStyle$1 = {
			...buttonStyle$1,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		function progressFillStyle(percent) {
			return {
				width: `${Math.max(0, Math.min(100, percent))}%`,
				height: "100%",
				borderRadius: "inherit",
				background: "var(--dsw-alias-brand-primary, #1677ff)"
			};
		}
		function dotStyle$1(status) {
			return {
				width: 9,
				height: 9,
				borderRadius: "50%",
				flex: "0 0 auto",
				background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
			};
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0).format(value);
		}
		function formatTime(ms) {
			return new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(new Date(ms));
		}
		/** One billing package as a labeled progress bar. */
		function CreditBar({ label, remain, size, t }) {
			const detail = size > 0 ? t("exactRemaining", {
				remain: formatNumber(remain),
				size: formatNumber(size)
			}) : t("creditPackageUnknownSize", { remain: formatNumber(remain) });
			const percent = size > 0 ? remain / size * 100 : 100;
			const display = new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(percent);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaGroupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("percentRemaining", { percent: display }) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: progressTrackStyle,
						role: "progressbar",
						"aria-label": label,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": percent,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: progressFillStyle(percent) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: detail
					})
				]
			});
		}
		/**
		* One model offer row: name, promotional badges, and the billing rate.
		*
		* The rate sits under the name rather than beside it because the row already
		* spends its horizontal budget on badges; stacking keeps long model names and
		* several badges from squeezing the rate into an ellipsis.
		*/
		function ModelOfferRow({ model, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: modelOfferStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: quotaLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: modelBadgeStyle,
						children: [model.badges?.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: modelBadgeLabel(badge, t)
						}, badge)), model.free === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: t("freeModel")
						}) : null]
					})]
				}), model.credits === void 0 ? model.rateUnknown === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rateUnknown")
				}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rate", { rate: model.credits })
				})]
			});
		}
		/**
		* Context capacity, listed in full.
		*
		* Every model the upstream reports a capacity for, largest first. A one-line
		* summary with the exceptions on hover was tried and rejected: capacity is
		* reference data you scan by model, and hiding most of it behind a hover made
		* the common case (a model you already have in mind) the hard one to look up.
		*
		* Purely a report of the upstream's own numbers. The plugin offers no tier
		* picker: the CN catalog declares one capacity per model and publishes no
		* alternatives, so a menu there would mean inventing client-side policy. The
		* international document does declare alternatives (`supportedLengths`), and
		* they are shown as a secondary figure rather than merged into one number —
		* the default is the budget actually requested, while the larger value is a
		* ceiling the upstream would accept.
		*/
		function ContextTable({ models, t }) {
			const known = (models ?? []).filter((model) => model.contextWindow !== void 0).sort((a, b) => b.contextWindow - a.contextWindow);
			if (known.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					style: quotaTitleStyle,
					children: t("contextHeading")
				}), known.map((model) => {
					const capacity = model.contextWindow;
					const alternative = model.maxContextWindow !== void 0 && model.maxContextWindow > capacity ? model.maxContextWindow : void 0;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: modelOfferStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { textAlign: "right" },
								children: formatTokens(capacity)
							}), alternative === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: modelRateStyle,
								children: t("contextUpTo", { size: formatTokens(alternative) })
							})]
						})]
					}, model.id);
				})]
			});
		}
		/**
		* Compact token count for display: the catalog's own round numbers (`200000`,
		* `1000000`) read better as `200K` / `1M`, and no precision is lost because
		* these values are always whole thousands.
		*/
		function formatTokens(tokens) {
			if (tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
			if (tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
			return String(tokens);
		}
		/**
		* Reasoning-effort detection section: consent switches, per-model detection,
		* and the recorded observations.
		*
		* Two deliberate UX rules from the plan (§3.1, §3.2):
		* - the confirmation is shown *before* any request, and its copy states the
		*   credit caveat;
		* - a `non-validating` result is presented as an observation about the
		*   parameter ("this model does not check it"), never as a statement that a
		*   level is unsupported.
		*/
		function ProbeSection({ probe, t, onDetect, onClear, busy }) {
			const [pending, setPending] = (0, react.useState)();
			const [runningModel, setRunningModel] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (pending !== void 0 && !probe.candidates.includes(pending)) setPending(void 0);
			}, [pending, probe.candidates]);
			const runningArmed = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (runningModel === void 0) return;
				if (busy || probe.running) {
					runningArmed.current = true;
					return;
				}
				if (!runningArmed.current) return;
				runningArmed.current = false;
				setRunningModel(void 0);
			}, [
				runningModel,
				busy,
				probe.running
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("probeHeading")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeIntro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeConsentHint")
					}),
					probe.running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeRunningGeneric")
					}) : null,
					probe.candidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeResultEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: quotaGroupStyle,
						children: probe.candidates.map((id) => {
							const result = probe.results.find((entry) => entry.id === id);
							const name = result?.name ?? id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: modelOfferStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: probeRowStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: probeRowEndStyle,
											children: [result === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: modelBadgeChipStyle,
												children: result.validation === "validating" && result.efforts.length > 0 ? result.efforts.join(" / ") : t(result.validation === "non-validating" ? "probeResultNotValidating" : "probeResultUnknown")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: buttonStyle$1,
												disabled: probe.running || busy,
												onClick: () => {
													setPending(id);
												},
												children: runningModel === id ? t("probeRunning", { model: id }) : t(result === void 0 ? "probeStart" : "probeRedetect")
											})]
										})]
									}),
									result === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: modelRateStyle,
										children: t("probeResultAt", { time: formatTime(result.probedAt) })
									}),
									pending === id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: confirmBoxStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: bodyStyle,
											children: t("probeConfirmBody", { model: name })
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
												style: primaryButtonStyle$1,
												disabled: probe.running || busy,
												onClick: () => {
													setRunningModel(id);
													setPending(void 0);
													onDetect(id);
												},
												children: t("probeConfirmAction")
											})]
										})]
									}) : null
								]
							}, id);
						})
					}),
					probe.results.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: buttonStyle$1,
						disabled: busy,
						onClick: () => {
							onClear();
						},
						children: t("probeClear")
					})
				]
			});
		}
		/** Render WorkBuddy sign-in state and credit as one expandable card. */
		function WorkBuddyPluginCard({ t, variant = CN_CARD_VARIANT }) {
			if (t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			const [open, setOpen] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)({ status: "signed-out" });
			const [busy, setBusy] = (0, react.useState)(false);
			const [tab, setTab] = (0, react.useState)("status");
			/**
			* Result of the last account action, shown under the list.
			*
			* Kept here rather than inside the tab because a re-render of the tab (the
			* status poll replaces the whole document) would drop a local message the
			* user has not read yet.
			*/
			const [notice, setNotice] = (0, react.useState)();
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const refresh = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(variant.statusPath, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (mounted.current && signal?.aborted !== true) setStatus(value);
				} catch (error) {
					if (mounted.current && signal?.aborted !== true) setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				}
			}, [t, variant.statusPath]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				refresh(controller.signal);
				return () => {
					controller.abort();
				};
			}, [open, refresh]);
			(0, react.useEffect)(() => {
				if (!open || status.status !== "signed-in") return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refresh(controller.signal);
				}, POLL_INTERVAL_MS$1);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				refresh,
				status.status
			]);
			const manualRefresh = async () => {
				setBusy(true);
				try {
					await refresh();
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			/**
			* Ask the host to re-read the credential and re-fetch this variant's catalog.
			*
			* Shares the probe route's key and guards: it is a write that spends an
			* upstream request, so it does not belong on the read-only status GET. A
			* failure is surfaced through the refreshed document's `catalog.error` rather
			* than thrown away, so the reason survives the round trip.
			*/
			const refreshModels = (0, react.useCallback)(async () => {
				const key = status.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setBusy(true);
				try {
					const response = await fetch(variant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						body: JSON.stringify({ action: "refresh" })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
				} catch (error) {
					if (mounted.current) setStatus((previous) => ({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					}));
					return;
				} finally {
					if (mounted.current) setBusy(false);
				}
				await refresh();
			}, [
				refresh,
				status,
				t,
				variant.probePath
			]);
			/**
			* Run one control action and refresh the card's state afterwards.
			*
			* The key travels in a header, not the body: it authorizes the write, and
			* the host never accepts a prompt, a sentinel, or a model outside its own
			* catalog from here.
			*/
			const control = (0, react.useCallback)(async (action) => {
				const key = status.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setBusy(true);
				try {
					const response = await fetch(variant.probePath, {
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
						const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${response.status}`;
						throw new Error(message);
					}
					await refresh();
				} catch (error) {
					if (mounted.current) setStatus((previous) => ({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					}));
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [
				refresh,
				status,
				t,
				variant.probePath
			]);
			/**
			* Start a detection. Confirmation happens inline in the section, so this is
			* only ever called after the user has already agreed.
			*/
			const confirmDetect = (0, react.useCallback)((modelId) => {
				control({
					action: "probe",
					model: modelId
				});
			}, [control]);
			/**
			* Run one account-pool action and return the host's answer.
			*
			* The key and route are the same pair the probe control uses, because both
			* are writes on the same origin; the difference is only which state they act
			* on. A failure is returned to the caller rather than turned into a card-wide
			* error: the account tab has its own place to report it, and the QR dialog
			* needs the reason inline ("this code expired") rather than a banner.
			*/
			const runAccountAction = (0, react.useCallback)(async (action) => {
				const key = status.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) {
					await refresh();
					return;
				}
				try {
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
						setNotice({
							text: message,
							isError: true
						});
						return;
					}
					const result = value;
					if (action.action === "test") {
						if (result.test !== void 0) setNotice({
							text: result.test.ok ? t("accountTestOk") : `${t("accountTestFailed")}: ${result.test.message}`,
							isError: !result.test.ok
						});
					} else if (action.action === "poll" && result.state === "added") setNotice({
						text: result.created === true ? t("accountAdded", { name: result.name ?? "" }) : t("accountUpdated"),
						isError: false
					});
					else if (result.state === "failed") setNotice({
						text: result.reason ?? t("requestFailed"),
						isError: true
					});
					return result;
				} catch (error) {
					setNotice({
						text: error instanceof Error ? error.message : t("requestFailed"),
						isError: true
					});
					return;
				}
			}, [
				refresh,
				status,
				t,
				variant.accountPath
			]);
			const title = t(variant.titleKey);
			const signedIn = status.status === "signed-in" ? status : void 0;
			/**
			* The account section, from whichever sign-in state carries it.
			*
			* Read off the document rather than narrowed from \`status.status\`: the
			* section is deliberately present in both states, and a union narrowed by the
			* discriminant loses a property the other arm also declares.
			*/
			const accountsSection = "accounts" in status ? status.accounts : void 0;
			const controlKey = "probeKey" in status ? status.probeKey : void 0;
			const label = status.status === "signed-in" ? status.nickname === void 0 ? t("signedInAs", { nickname: "" }).trimEnd().replace(/[:：]$/, "") : t("signedInAs", { nickname: status.nickname }) : status.status === "error" ? t("requestFailed") : t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: headerStyle$1,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: headTextStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: nameStyle,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: descriptionStyle,
							children: t(variant.introKey)
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						style: {
							...chevronStyle,
							transform: open ? "rotate(180deg)" : "none"
						},
						children: "⌄"
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cardBodyStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: quotaTitleStyle,
							children: t("accountHeading")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: statusStyle,
								role: "status",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: dotStyle$1(status.status)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: buttonStyle$1,
								disabled: busy,
								onClick: () => {
									manualRefresh();
								},
								children: busy ? t("refreshing") : t("refresh")
							})]
						}),
						signedIn !== void 0 || accountsSection !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							signedIn?.expiresAt === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("accessTokenExpires", { time: formatTime(signedIn?.expiresAt) })
							}),
							signedIn?.catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: bodyStyle,
									children: [signedIn?.catalog.source === "live" && signedIn?.catalog.fetchedAt !== void 0 ? t("catalogLive", { time: formatTime(signedIn?.catalog.fetchedAt) }) : signedIn?.catalog.source === "saved" && signedIn?.catalog.fetchedAt !== void 0 ? t("catalogSaved", { time: formatTime(signedIn?.catalog.fetchedAt) }) : t("catalogFallback"), signedIn?.catalog.appVersion === void 0 ? "" : ` · ${t("catalogAppVersion", { version: signedIn?.catalog.appVersion })}`]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy,
									onClick: () => {
										refreshModels();
									},
									children: busy ? t("refreshingModels") : t("refreshModels")
								})]
							}),
							signedIn?.catalog?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: t("catalogError", { message: signedIn?.catalog.error })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								role: "tablist",
								style: tabBarStyle,
								children: [
									"status",
									"context",
									"details",
									"accounts"
								].map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === id,
									onClick: () => {
										setTab(id);
									},
									style: {
										...tabStyle,
										...tab === id ? tabActiveStyle : {}
									},
									children: t(id === "status" ? "tabStatus" : id === "context" ? "tabContext" : id === "details" ? "tabDetails" : "tabAccounts")
								}, id))
							}),
							tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [
									signedIn?.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: quotaListStyle,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: rowStyle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												style: quotaTitleStyle,
												children: t("creditsHeading")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: bodyStyle,
												children: t("creditsTotal", { total: formatNumber(signedIn?.credits.total) })
											})]
										})
									}),
									signedIn?.creditsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: errorStyle,
										children: t("creditsError", { message: signedIn?.creditsError })
									}),
									signedIn?.probe === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProbeSection, {
										probe: signedIn?.probe,
										t,
										busy,
										onDetect: confirmDetect,
										onClear: () => {
											control({ action: "clear" });
										}
									})
								]
							}) : tab === "accounts" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: tabPanelStyle,
								children: accountsSection === void 0 || controlKey === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: bodyStyle,
									children: t("accountUnavailable")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkBuddyAccountsTab, {
									accounts: accountsSection,
									accountPath: variant.accountPath,
									probeKey: controlKey,
									t,
									busy,
									run: runAccountAction,
									refresh,
									...notice === void 0 ? {} : {
										notice: notice.text,
										noticeIsError: notice.isError
									}
								})
							}) : tab === "context" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: tabPanelStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextTable, {
									models: signedIn?.models,
									t
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [signedIn?.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("creditsDetailHeading")
									}), signedIn?.credits.accounts.filter((account) => account.remain > 0).map((account, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditBar, {
										label: account.packageName,
										remain: account.remain,
										size: account.size,
										t
									}, `${account.packageName}-${String(index)}`))]
								}), signedIn?.models === void 0 || signedIn?.models.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("modelsHeading")
									}), signedIn?.models.filter((model) => model.free === true || (model.badges?.length ?? 0) > 0).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelOfferRow, {
										model,
										t
									}, model.id))]
								})]
							})
						] }) : null,
						status.status === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: status.reason === void 0 ? bodyStyle : errorStyle,
							children: status.reason ?? t(variant.signedOutKey)
						}) : null,
						status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: status.message
						}) : null
					]
				}) : null]
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
			borderRadius: 10,
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
					children: t("floatingRetryIn", { minutes: Math.max(1, Math.ceil(((cooldown?.untilMs ?? 0) - now) / 6e4)) })
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: groupNameStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								style: {
									...dotStyle,
									display: "inline-block",
									marginRight: 6,
									background: statusColor(status?.status)
								}
							}), t(variant.titleKey)]
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
		*/
		function tooltipText(t, model, state) {
			if (state.busy) return t("probeRunning", { model });
			if (state.failed) return t("probeTooltipRetry");
			const result = state.result;
			if (result === void 0) return t("probeTooltipIdle", { model });
			if (result.validation === "validating" && result.efforts.length > 0) return t("probeTooltipVerified", { levels: result.efforts.join(" / ") });
			if (result.validation === "non-validating") return t("probeTooltipNotValidating");
			return t("probeTooltipRetry");
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
			const tooltipId = (0, react.useId)();
			const refresh = (0, react.useCallback)(async (signal) => {
				const response = await fetch(card.statusPath, {
					credentials: "same-origin",
					headers: { accept: "application/json" },
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const value = await response.json();
				if (mounted.current && !signal?.aborted) setStatus(value);
			}, [card.statusPath]);
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
		//#region src/client/locales.ts
		/** Plugin-card copy registered under the settings.workbuddy locale namespace. */
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
			percentRemaining: "{percent}% remaining",
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
			accountHeading: "Account",
			modelsHeading: "Model offers",
			contextHeading: "Context window",
			contextUpTo: "up to {size}",
			freeModel: "Free",
			badgeLimitedFree: "Limited-time free",
			badgeNightDiscount: "Night discount",
			badgeFreeNow: "Free now",
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
			tabAccounts: "Accounts",
			accountAdd: "Add by QR",
			accountAddTitle: "Scan to add an account",
			accountAddBody: "Open the mobile app, sign in, and scan this code. The account is added to the plugin only — it does not change the desktop app's sign-in.",
			accountAddWaiting: "Waiting for the scan… ({seconds}s left)",
			accountCheckNow: "Check now",
			accountChecking: "Checking…",
			accountQrExpired: "This code expired. Close the dialog and start again.",
			accountQrInvalid: "This sign-in is no longer valid. Start again.",
			accountEmpty: "No accounts yet. Sign in to the desktop app, or add one by QR.",
			accountUnavailable: "The host did not report its account pool. Update the plugin, or restart DSH.",
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
			accountStateWaiting: "{reason} · retry in {minutes} min",
			accountAdded: "Added {name}",
			accountUpdated: "That account was already here; its sign-in was refreshed.",
			accountTestOk: "Connected",
			accountTestFailed: "Test failed",
			floatingTitle: "Accounts",
			floatingCollapse: "Hide",
			floatingExpand: "Show",
			floatingNoAccount: "No account",
			floatingRetryIn: "retry {minutes} min",
			floatingSettingLabel: "Floating account window",
			floatingSettingHint: "Show each account and its remaining balance over the conversation."
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
			percentRemaining: "剩余 {percent}%",
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
			accountHeading: "账号",
			modelsHeading: "模型优惠",
			contextHeading: "上下文窗口",
			contextUpTo: "最高 {size}",
			freeModel: "免费",
			badgeLimitedFree: "限时免费",
			badgeNightDiscount: "夜间折扣",
			badgeFreeNow: "限时免费",
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
			tabAccounts: "账号",
			accountAdd: "扫码添加",
			accountAddTitle: "扫码添加账号",
			accountAddBody: "打开手机 App 登录后扫描此二维码。账号只加入本插件，不会改变桌面 App 的登录状态。",
			accountAddWaiting: "等待扫码…（剩余 {seconds} 秒）",
			accountCheckNow: "立即检查",
			accountChecking: "检查中…",
			accountQrExpired: "二维码已过期，关闭后重新发起。",
			accountQrInvalid: "该登录已失效，请重新发起。",
			accountEmpty: "还没有账号。可在桌面 App 登录，或在此扫码添加。",
			accountUnavailable: "宿主未返回账号列表。请更新插件或重启 DSH。",
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
			accountStateWaiting: "{reason} · {minutes} 分钟后重试",
			accountAdded: "已添加 {name}",
			accountUpdated: "该账号已存在，已更新其登录凭证。",
			accountTestOk: "连通正常",
			accountTestFailed: "测试失败",
			floatingTitle: "账号",
			floatingCollapse: "收起",
			floatingExpand: "展开",
			floatingNoAccount: "暂无账号",
			floatingRetryIn: "{minutes} 分钟后重试",
			floatingSettingLabel: "悬浮账号窗",
			floatingSettingHint: "在对话内容右上角显示各账号及其剩余积分。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-connect-client";
		/**
		* Client services required by the Plugin configuration contribution.
		*
		* DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
		* hold the browser `ClientContext` alias and the `slots` service). The services
		* this card relies on now come from narrower packages: the `slots` registry
		* moved to `@deepseek-ai/dsh-client-ui-renderer`, `locale` stayed in
		* `@deepseek-ai/dsh-client-locale`, and the `settings.plugin.item` slot is
		* declared by `@deepseek-ai/dsh-client-ui-settings-plugins`. All three are
		* named in the package's `dsh.client.inject` list, so cordis has activated
		* them before this plugin's fiber starts.
		*/
		const inject = ["slots", "locale"];
		/**
		* Register card copy and the WorkBuddy card under Plugin configuration.
		*
		* The entire body is wrapped so that a DSH slot-API breaking change (for
		* example the rc.6→rc.7 `id`→`key` / `order`→`priority` rename) degrades
		* to a `console.error` instead of throwing into the DSH loader and raising
		* the red "Failed to load plugins" banner. The host provider keeps working:
		* the `workbuddy` model channel is unaffected, and `dsh-workbuddy-connect
		* status` reports host health via the heartbeat file.
		*
		* NOTE: the try/catch boundary of this function is mirrored (duplicated) in
		* `tests/client-fallback.spec.ts`, because the real client entry imports
		* browser-only DSH packages that cannot load in the Node test environment.
		* That test therefore does not import this function — it replicates its
		* shape. If you change the guarded body or the `console.error` message here,
		* update the mirrored `apply()` in that spec too, or the fallback test will
		* silently diverge from this real implementation.
		*/
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-workbuddy-connect: settings copy");
				const t = ctx.locale.bind(namespace);
				for (const [index, variant] of CARD_VARIANTS.entries()) ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: variant.id,
					priority: 30 - index,
					inject: () => ({
						t,
						variant
					})
				}, WorkBuddyPluginCard));
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "workbuddy-floating-accounts",
					order: 90,
					inject: () => ({ t })
				}, WorkBuddyFloatingAccounts));
				ctx.inject(["modelDirectories"], (scope) => {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({
						name: "conversation.input.right",
						id: "workbuddy-probe",
						order: 10,
						inject: (sessionId) => ({
							directory: scope.modelDirectories.directoryFor(sessionId).store,
							t
						})
					}, WorkBuddyProbeControl));
				});
			} catch (error) {
				console.error("[dsh-workbuddy-connect] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
