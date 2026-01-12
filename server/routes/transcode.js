const express = require('express');
const router = express.Router();
const { spawn, exec } = require('child_process');

/**
 * Transcode stream optimizado para Raspberry Pi 4
 * Especial para películas MKV y visualización en iOS/Safari
 */
router.get('/', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';
    const ffprobePath = req.app.locals.ffprobePath || 'ffprobe';

    // DETECCIÓN INTELIGENTE DE PELÍCULA (VOD)
    const isVOD = url.includes('/movie/') || 
                  url.includes('/series/') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // CONFIGURACIÓN DE FLAGS SEGÚN EL TIPO
    const movFlags = isVOD 
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_keyframe+default_base_moof' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    console.log(`[NodeCast] Iniciando: ${isVOD ? 'PELÍCULA (VOD)' : 'CANAL EN DIRECTO'}`);

    // --- PROBE con ffprobe para obtener duración ---
    let durationSeconds = null;
    if (isVOD) {
        try {
            const cmd = `${ffprobePath} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`;
            durationSeconds = await new Promise((resolve, reject) => {
                exec(cmd, (err, stdout, stderr) => {
                    if (err) return reject(err);
                    const dur = parseFloat(stdout);
                    resolve(isNaN(dur) ? null : dur);
                });
            });
            console.log(`[NodeCast] Duración detectada: ${durationSeconds}s`);
        } catch (err) {
            console.warn('[NodeCast] No se pudo obtener duración con ffprobe:', err.message);
        }
    }

    // ARGUMENTOS FFMPEG
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-user_agent', 'VLC/3.0.20 (Linux; x86_64)',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', url,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k',
        '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
        '-f', 'mp4',
        '-movflags', movFlags,
        '-max_muxing_queue_size', '4096',
        '-bufsize', isVOD ? '50M' : '8M',
        '-flush_packets', '1',
        '-'
    ];

    console.log('[FFmpeg Full Command]', `${ffmpegPath} ${args.join(' ')}`);

    let ffmpeg;
    try {
        ffmpeg = spawn(ffmpegPath, args);
    } catch (spawnErr) {
        console.error('[Transcode] Error fatal al iniciar FFmpeg:', spawnErr);
        return res.status(500).json({ error: 'FFmpeg failed' });
    }

    // HEADERS para navegador
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (durationSeconds) {
        res.setHeader('X-Video-Duration', durationSeconds); // Duración en segundos
    }

    // STREAM
    ffmpeg.stdout.pipe(res);

    let ffmpegStarted = false;
    ffmpeg.stdout.once('data', () => {
        ffmpegStarted = true;
    });

    // Manejo de errores críticos
    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.error('[FFmpeg Error]', msg.trim());
        }
    });

    // Limpieza al cerrar la pestaña
    req.on('close', () => {
        if (ffmpegStarted) {
            console.log('[Transcode] Cliente desconectado tras iniciar reproducción. Cerrando FFmpeg...');
            ffmpeg.kill('SIGKILL');
        } else {
            console.log('[Transcode] Cliente desconectado antes de iniciar streaming. No matamos FFmpeg todavía.');
        }
    });

    ffmpeg.on('exit', code => {
        if (!ffmpegStarted && !res.headersSent) {
            res.status(500).json({ error: `FFmpeg no pudo iniciar, código ${code}` });
        } else if (code !== 0 && code !== 255) {
            console.error(`[Transcode] FFmpeg terminó con error: ${code}`);
        }
    });
});

module.exports = router;
