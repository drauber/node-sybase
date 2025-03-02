
/*

Ifs added for no crash app - Douglas Rauber - 2021-08-18

*/

var spawn = require('child_process').spawn;
var JSONStream = require('JSONStream');
var fs = require("fs");
var path = require("path");


function Sybase(host, port, dbname, username, password, logTiming, pathToJavaBridge, { encoding = "utf8", extraLogs = false } = {})
{
    this.connected = false;
    this.host = host;
    this.port = port;
    this.dbname = dbname;
    this.username = username;
    this.password = password;
    this.logTiming = (logTiming == true);
    this.encoding = encoding;
    this.extraLogs = extraLogs;

    this.pathToJavaBridge = pathToJavaBridge;
    if (this.pathToJavaBridge === undefined)
    {
        this.pathToJavaBridge = path.resolve(__dirname, "..", "JavaSybaseLink", "dist", "JavaSybaseLink.jar");
    }

    this.queryCount = 0;
    this.currentMessages = {}; // look up msgId to message sent and call back details.

    this.jsonParser = JSONStream.parse();
}

Sybase.prototype.log = function(msg)
{
    if (this.extraLogs) {
        console.log(msg);
    }
}

Sybase.prototype.connect = function(callback)
{
    var that = this;
    this.javaDB = spawn('java',["-jar",this.pathToJavaBridge, this.host, this.port, this.dbname, this.username, this.password]);

    var hrstart = process.hrtime();
	this.javaDB.stdout.once("data", function(data) {
		if ((data+"").trim() != "connected")
		{
			callback(new Error("Error connecting " + data));
			return;
		}

		that.javaDB.stderr.removeAllListeners("data");
		that.connected = true;

		// set up normal listeners.
		that.javaDB.stdout.setEncoding(that.encoding).pipe(that.jsonParser).on("data", function(jsonMsg) { that.onSQLResponse.call(that, jsonMsg); });
		that.javaDB.stderr.on("data", function(err) { that.onSQLError.call(that, err); });

		callback(null, data);
	});

	// handle connection issues.
    this.javaDB.stderr.once("data", function(data) {
    	that.javaDB.stdout.removeAllListeners("data");
    	that.javaDB.kill();
    	callback(new Error(data));
    });
};

Sybase.prototype.disconnect = function()
{
	this.javaDB.kill();
	this.connected = false;
}

Sybase.prototype.isConnected = function()
{
    return this.connected;
};

Sybase.prototype.query = function(sql, callback)
{
    if (this.isConnected() === false)
    {
    	callback(new Error("database isn't connected."));
    	return;
    }
    var hrstart = process.hrtime();
    this.queryCount++;

    var msg = {};
    msg.msgId = this.queryCount;
    msg.sql = sql;
    msg.sentTime = (new Date()).getTime();
    var strMsg = JSON.stringify(msg).replace(/[\n]/g, '\\n');
    msg.callback = callback;
    msg.hrstart = hrstart;

    this.log("this: " + this + " currentMessages: " +  this.currentMessages + " this.queryCount: " + this.queryCount);

    this.currentMessages[msg.msgId] = msg;

    this.javaDB.stdin.write(strMsg + "\n");
    this.log("sql request written: " + strMsg);
};

Sybase.prototype.onSQLResponse = function(jsonMsg)
{
    var err = null;
	var request = this.currentMessages[jsonMsg.msgId];
	delete this.currentMessages[jsonMsg.msgId];

	var result = jsonMsg.result;
	if (result.length === 1)
		result = result[0]; //if there is only one just return the first RS not a set of RS's

	var currentTime = (new Date()).getTime();
	var sendTimeMS = currentTime - jsonMsg.javaEndTime;

    //If added for no crash app - Douglas Rauber - 2021-08-18
    if (request) {
        hrend = process.hrtime(request.hrstart);
    }
	var javaDuration = (jsonMsg.javaEndTime - jsonMsg.javaStartTime);

    if (jsonMsg.error !== undefined)
        err = new Error(jsonMsg.error);


	if (this.logTiming)
		console.log("Execution time (hr): %ds %dms dbTime: %dms dbSendTime: %d sql=%s", hrend[0], hrend[1]/1000000, javaDuration, sendTimeMS, request.sql);
	
    //If added for no crash app - Douglas Rauber - 2021-08-18
    if (request){
        request.callback(err, result);
    }
};

Sybase.prototype.onSQLError = function(data)
{
	var error = new Error(data);

    var callBackFuncitons = [];
	for (var k in this.currentMessages){
    	if (this.currentMessages.hasOwnProperty(k)) {
            callBackFuncitons.push(this.currentMessages[k].callback);
    	}
	}

    // clear the current messages before calling back with the error.
    this.currentMessages = [];
    callBackFuncitons.forEach(function(cb) {
        cb(error);
    });
};

module.exports = Sybase;
