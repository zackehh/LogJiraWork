#!/usr/bin/env node
var args = require('minimist')(process.argv.slice(2)),
    exec = require('shelljs').exec,
    fs   = require('fs'),
    path = require('path'),
    print = console.log;

var CONFIG_FILE = path.join(__dirname, 'config.js');

var stat = fs.statSync(CONFIG_FILE);
if(!canWrite(process.uid === stat.uid, process.gid === stat.gid, stat.mode)) {
    exec('sudo chmod 777 ' + CONFIG_FILE, {
        async:false
    });
}

// define options
var start = args.s || args.start;
var pause = args.p || args.pause;
var resume = args.r || args.resume;
var end = args.e || args.end;
var last = args.l || args.last;

var config;
try {
    config = require(CONFIG_FILE);
} catch(e) {
    // We don't care, because we default to current dir anyway
}
var TIME_FILE = config.path || path.join(process.cwd(), 'time.json');

if(start){
    pleaseEnter('start');
    var jobs = { };

    try {
        var j = require(TIME_FILE),
            d = j[start];

        if(d && !~d.endMs){
            throw new Error('Already started timer on ' + d.startTimeSlice);
        } else {
            jobs = j;
        }
    } catch(err) {
        if(err.message === 'ENOENT, no such file or directory \'' + TIME_FILE + '\''){
            print(TIME_FILE + ' doesn\'t exist. Will create one.');
            fs.appendFileSync(TIME_FILE, '');
            // and continue forward to start the timer
        } else {
            print(err.message);
            return;
        }
    }

    var timeSlice = getTimeSlice(new Date());
    print('Started timer at ' + timeSlice);

    jobs[args.start] = {
        ticket: start, // Only here for the --last flag
        startMs: Date.now(),
        endMs: -1,
        pausesMs: [],
        elapsed: 0,
        jira: '',
        startTimeSlice: timeSlice,
        endTimeSlice: ''
    };
    fs.writeFileSync(TIME_FILE, JSON.stringify(jobs, null, 4));
} else if(pause){
    pleaseEnter('pause');

    var jobs    = null,
        lastJob = null;

    try {
        jobs    = require(TIME_FILE),
        lastJob = jobs[pause];

        var totalPauses = lastJob.pausesMs.length;
        if(totalPauses > 0 && totalPauses%2){
            // assuming pausesMs = [pause_n, resume_m, pause_m]
            throw new Error('Cannot pause again since you already pause your current task.');
        }
    } catch(err) {
        if(err.message === 'ENOENT, no such file or directory \'' + TIME_FILE + '\''){
            print('Cannot pause if you didn\'t start a task.');
        } else {
            print(err.message);
        }
        return;
    }

    print('Pausing timer at ' + getTimeSlice(new Date()));
    lastJob.pausesMs.push(Date.now());
    fs.writeFileSync(TIME_FILE, JSON.stringify(jobs, null, 4));
} else if(resume){
    pleaseEnter('resume');

    var jobs    = null,
        lastJob = null;

    try {
        jobs      = require(TIME_FILE),
        lastJob   = jobs[resume];

        var totalPauses = lastJob.pausesMs.length;
        if(!totalPauses || !(totalPauses%2)){
            // assuming pausesMs = [] or [pause_n, resume_m, pause_m, resume_p]
            throw new Error('Cannot resume if you didn\'t pause a task.');
        }
    } catch(err) {
        if(err.message === 'ENOENT, no such file or directory \'' + TIME_FILE + '\''){
            print('Cannot resume if you didn\'t pause a task.');
        } else {
            print(err.message);
        }
        return;
    }

    print('Resuming timer at ' + getTimeSlice(new Date()));
    lastJob.pausesMs.push(Date.now());
    fs.writeFileSync(TIME_FILE, JSON.stringify(jobs, null, 4));
} else if(end){
    pleaseEnter('end');

    var jobs = {
        data: []
    };

    try {
        var j = require(TIME_FILE),
            d = j[end];

        if(d && ~d.endMs){
            throw new Error('Previous job finished. Run \'node job.js start\' to start another timer.');
        } else {
            jobs = j;
        }
    } catch(err){
        if(err.message === 'ENOENT, no such file or directory \'' + TIME_FILE + '\''){
            print('A job does not exist. To start the timer, run \'node job.js start\'');
        } else {
            print(err.message);
        }
        return;
    }

    var lastJob = jobs[end];

    lastJob.endMs        = Date.now();
    lastJob.endTimeSlice = getTimeSlice(new Date());
    var pauses = lastJob.pausesMs.length;

    // check if there has been any pauses/resumes between when the task started (startMs) and finished (endMs)
    if(pauses > 0){

        // assuming pausesMs has the [pause, resume] combination ...
        for(var i = 0; i < pauses; i++){
            if(!i){
                // get the elapsed time from start (startMs) to first pause (pausesMs[i].ms)
                lastJob.elapsed += lastJob.pausesMs[i] - lastJob.startMs;

            } else if(i%2 && (i === pauses - 1)){
                // if the last action was a resume in pausesMs, then get the elapsed time from last resume to when the task finished (endMs)
                lastJob.elapsed += lastJob.endMs - lastJob.pausesMs[i];

            } else if(!(i%2)){ // assuming [pause, resume] combo, pause will land on the even index
                // get the elapsed time from when the task started resuming (pausesMs[i - 1]) to the next pause (pausesMs[i])
                lastJob.elapsed += lastJob.pausesMs[i] - lastJob.pausesMs[i - 1];
            }
        }

    } else {
        // otherwise, get the elapsed time from start (startMs) to finish (endMs)
        lastJob.elapsed = lastJob.endMs - lastJob.startMs;
    }

    lastJob.jira = getJiraFormat(lastJob.elapsed);
    fs.writeFileSync(TIME_FILE, JSON.stringify(jobs, null, 4));

    print('Ended timer at ' + lastJob.endTimeSlice);
    print('Jira format: ' + lastJob.jira);
} else if(last) {

    // This gets slightly different here
    try {
        var jobs = require(TIME_FILE);
    } catch(e) {
        print("\nFile inaccessible... Are you sure you have stored data?");
        return;
    }

    var ended = { endMs:0 };
    for(var job in jobs){
        if(jobs[job].endMs > ended.endMs){
            ended = jobs[job];
        }
    }
    if(ended.endMs){
        print("\nHere is the record of the last finished job:\n");
        print(JSON.stringify(ended, null, 4));
    } else {
        print("Unable to find the last ended job.");
    }
} else if(args.clean){
    // Unlink the stored file
    fs.unlinkSync(TIME_FILE);
    print("Successfully deleted " + TIME_FILE);

} else if(args['set-time-path']) {

    var path = args['set-time-path'];
    if(path.toString() != "true" && path.substr(path.length - 5) == '.json'){
        config.path = args['set-time-path'];
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        print("Path successfully changed.");
    } else {
        print("Please enter a path in the format --set-time-path=/path/you/want.json");
    }

} else if(args['get-time-path']) {
    print('Logs will be saved to ' + TIME_FILE);
} else if(args['set-default-path']) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 4));
    print('The logging path has been changed to the current working directory.');
} else if(args['list-jobs']){
    try {
        var jobs = require(TIME_FILE);
    } catch(e) {
        print("\nFile inaccessible... Are you sure you have stored data?");
        return;
    }
    var i = 1, unfinished = [];
    for(var job in jobs){
        if(!~jobs[job].endMs){
           unfinished.push((i++) + ". " + job);
        }
    }
    if(unfinished.length){
        print("\nHere is a list of all currently stored unfinished jobs:\n");
        for(var job in unfinished){
            print(unfinished[job]);
        }
        print("");
    } else {
        print("There are currently no unfinished jobs, good work!");
    }
} else if(args['help']){

    print('Usage: jiratrack <command>\n');
    print('Each <command> can be:\n');

    // [cmd, description ...] combination
    var cmdDesc = [
        '--start <TICKET_NUM>',
        'Starts the job timer.',

        '--pause <TICKET_NUM>',
        'Pause the job timer.',

        '--resume <TICKET_NUM>',
        'Resume the job timer.',

        '--stop <TICKET_NUM>',
        'Stops the job timer and returns the tracked work time in Jira format.',

        '--last',
        'Shows the last finished job in JSON.',

        '--set-time-path',
        'Sets the path that jiratrack will store your log data to.',

        '--set-default-path',
        'Sets the path that jiratrack should use to be the current working directory.',

        '--get-time-path ',
        'Returns the current path that jiratrack is using to log out to.',

        '--list-jobs',
        'Returns a list of started jobs, but not finished jobs.',

        '--clean',
        'Deletes the file that --set-time-path is pointing to.'
    ];

    for(var i = 0; i < cmdDesc.length; i+=2){
        print('    ' + cmdDesc[i]);
        print('        ' + cmdDesc[i + 1] + '\n');
    }


} else {
    print('Use \'jiratrack --help\' to see a list of commands.');
}

/**
 * Converts a time in milliseconds to a readable string
 *
 * @param ms            the time in millis to convert
 * @returns {string}    a human readable string
 */
function getJiraFormat(ms) {
    var millis = ms % 1000,
        ms = (ms - millis) / 1000,
        secs = ms % 60,
        ms = (ms - secs) / 60,
        mins = ms % 60,
        hrs = (ms - mins) / 60;
    return (hrs ? hrs + 'h ' : '') + (mins ? mins + 'm ' : '') + (secs ? secs + 's' : mins ? '\b' : hrs ? '\b' : '');
}

// Check if file is writable
function canWrite(owner, inGroup, mode) {
    return owner && (mode & 00200) || // User is owner and owner can write.
        inGroup && (mode & 00020) || // User is in group and group can write.
        (mode & 00002); // Anyone can write.

}

// returns date and time in human readable format
function getTimeSlice(date){
    return new Date(date).toString();
}

// Check params
function pleaseEnter(action){
    if(args[action] == true){
        print("Please enter a JIRA ticket to " + action + ".");
        process.exit();
    }
}
