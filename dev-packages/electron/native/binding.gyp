
{
    'targets': [{
        'target_name': 'ffmpeg-test',
        'cflags!': [ '-fno-exceptions' ],
        'cflags_cc!': [ '-fno-exceptions' ],
        'sources': [
            'src/electron-h264-test.cpp',
        ],
        'include_dirs': [
            "<!@(node -p \"require('node-addon-api').include\")",
        ],
        'libraries': [
            "<!@(node -p \"require('../electron-ffmpeg-lib.js').libffmpegAbsolutePath()\")",
        ],
        'dependencies': [
            "<!(node -p \"require('node-addon-api').gyp\")",
        ],
        'defines': [
            'NAPI_DISABLE_CPP_EXCEPTIONS',
        ],
    }],
}
