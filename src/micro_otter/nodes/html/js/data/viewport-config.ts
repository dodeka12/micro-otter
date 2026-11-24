export interface ViewportConfigData {
	translateX?: number;
	translateY?: number;
	scale?: number;
}

export class ViewportConfig {
	translateX: number;

	translateY: number;

	scale: number;

	constructor({ translateX = 0, translateY = 0, scale = 1 }: ViewportConfigData = {}) {
		this.translateX = Number.isFinite(translateX) ? translateX : 0;
		this.translateY = Number.isFinite(translateY) ? translateY : 0;
		this.scale = Number.isFinite(scale) ? scale : 1;
	}

	toData(): Required<ViewportConfigData> {
		return {
			translateX: this.translateX,
			translateY: this.translateY,
			scale: this.scale,
		};
	}

	clone(): ViewportConfig {
		return new ViewportConfig({
			translateX: this.translateX,
			translateY: this.translateY,
			scale: this.scale,
		});
	}

	static fromData(data: ViewportConfigData = {}): ViewportConfig {
		return new ViewportConfig(data || {});
	}
}
