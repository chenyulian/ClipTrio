export const fixtureDuration = 6;
export const fixtureWidth = 360;
export const fixtureHeight = 640;

export const fixtures = [
  {
    slot: 'top',
    filename: 'fixture-top.mp4',
    colors: ['B8203A', 'D94B62', 'F0788A', '992039', 'C13A51', 'E66578']
  },
  {
    slot: 'middle',
    filename: 'fixture-middle.mp4',
    colors: ['137A55', '1F9D70', '43BD8B', '0D6042', '2A8B67', '62CDA2']
  },
  {
    slot: 'bottom',
    filename: 'fixture-bottom.mp4',
    colors: ['185FA5', '287FC1', '55A4DB', '164A7C', '367DB2', '73B7E3']
  }
];

export const smokeSettings = {
  starts: [0, 1, 2],
  clipLength: 2,
  exportLength: 4,
  captions: ['TOP TEST', 'MIDDLE TEST', 'BOTTOM TEST']
};

export const sampleTimes = [0.25, 1.25, 2.25];

export function hexToRgb(value) {
  const normalized = String(value).replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid RGB color: ${value}`);
  return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export function expectedColorsAt(outputTime) {
  const loopTime = ((Number(outputTime) % smokeSettings.clipLength) + smokeSettings.clipLength)
    % smokeSettings.clipLength;
  return fixtures.map((fixture, index) => {
    const sourceSecond = Math.floor(smokeSettings.starts[index] + loopTime);
    return hexToRgb(fixture.colors[sourceSecond]);
  });
}

export function decodeSampleStrip(buffer, blockSize = 2) {
  const width = blockSize * fixtures.length;
  const expectedBytes = width * blockSize * 3;
  if (buffer.length !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} RGB sample bytes, received ${buffer.length}.`);
  }

  return fixtures.map((_, slot) => {
    const totals = [0, 0, 0];
    for (let y = 0; y < blockSize; y += 1) {
      for (let x = slot * blockSize; x < (slot + 1) * blockSize; x += 1) {
        const offset = (y * width + x) * 3;
        totals[0] += buffer[offset];
        totals[1] += buffer[offset + 1];
        totals[2] += buffer[offset + 2];
      }
    }
    const pixels = blockSize * blockSize;
    return totals.map(total => Math.round(total / pixels));
  });
}

export function validateSampleColors(actual, expected, tolerance = 38) {
  actual.forEach((rgb, slot) => {
    rgb.forEach((channel, channelIndex) => {
      const delta = Math.abs(channel - expected[slot][channelIndex]);
      if (delta > tolerance) {
        throw new Error(
          `${fixtures[slot].slot} sample ${rgb.join(',')} does not match expected ${expected[slot].join(',')} `
          + `(channel delta ${delta}, tolerance ${tolerance}).`
        );
      }
    });
  });
}

export function validateProbeResult(probe) {
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format?.duration);

  if (!video) throw new Error('Rendered file has no video stream.');
  if (video.codec_name !== 'h264') throw new Error(`Expected H.264 video, received ${video.codec_name || 'unknown'}.`);
  if (video.width !== 1080 || video.height !== 1920) {
    throw new Error(`Expected 1080x1920 output, received ${video.width}x${video.height}.`);
  }
  if (video.pix_fmt !== 'yuv420p') throw new Error(`Expected yuv420p, received ${video.pix_fmt || 'unknown'}.`);
  if (video.r_frame_rate !== '30/1') throw new Error(`Expected 30fps, received ${video.r_frame_rate || 'unknown'}.`);
  if (!audio || audio.codec_name !== 'aac') throw new Error('Expected an AAC audio stream.');
  if (!Number.isFinite(duration) || Math.abs(duration - smokeSettings.exportLength) > 0.2) {
    throw new Error(`Expected about ${smokeSettings.exportLength}s duration, received ${probe.format?.duration || 'unknown'}.`);
  }

  return { video, audio, duration };
}
