const mongoose = require('mongoose');
const moment = require('moment');
const { Schema } = mongoose;

const freepikOverviewSchema = new Schema({
    username: String,
    userId: Number,
    site: String,
    domain: String,
    proxyType: String,
    time: {
      type: Date,
      default: Date.now,
      required: true,
    }
});

freepikOverviewSchema.statics.countRequests = async function(userId, username, site, proxyType) {
    const todayEnd = moment().endOf('d').utc();
    const todayStart = moment().startOf('d').utc();
    return await this.count({
        userId,
        username,
        site,
        proxyType,
        time: {
            $gte: todayStart,
            $lte: todayEnd
        }
    });
}

const freepikOverview = mongoose.model('freepikoverview', freepikOverviewSchema);

module.exports = freepikOverview;