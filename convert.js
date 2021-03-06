const config = require('./config')
const moment = require('moment')
// const jira = require('./jira')
// const redmine = require('./redmine')

// const j2rAttachment = async (attachment) => {
//  let jiraReq = jira.getAttachment(attachment.content)
//  const req = redmine.addAttachment()
//  jiraReq.pipe(req)
// }

const j2rFormatComment = (comment) => {
  const author = comment.author.displayName
  const body = comment.body
  return `**Message from ${author} on Jira**\n${body}`
}

const j2rGetJiraType = (issue) => {
  return issue.fields[`customfield_${config.JiraBugType}`].id
}

const j2rGetRedmineIssue = (issue) => {
  const redmineURL = issue.fields[`customfield_${config.JiraRedmineRef}`]
  return redmineURL.split('/').pop()
}

const j2rGetRedmineProject = (issue) => {
  return config.JiraMapProject[issue.fields.project.id]
}

const j2rCreateIssue = async ({issue}) => {
  // TODO: stream attachments
  const create = {
    category_id: 150,
    tracker_id: config.JiraMapTracker[issue.fields.issuetype.id],
    status_id: 1,
    priority_id: config.JiraMapPriority[issue.fields.priority.id],
    custom_fields: [
      {id: 21, value: 50}, // TODO: hard coded?
      {id: config.RedmineJiraRef, value: issue.key}
    ],
    notes: [],
    uploads: []
  }
  // const uploads = issue.fields.attachment.map(a => j2rAttachment(a).then(r => create.uploads.push(r)))
  const type = j2rGetJiraType(issue)
  if (type === config.JiraGenerique) {
    create.project_id = config.RedmineSupportDev
    create.subject = issue.fields[`customfield_${config.JiraTitle}`]
    create.description = issue.fields[`customfield_${config.JiraDescription}`]
  } else {
    create.project_id = j2rGetRedmineProject(issue)
    create.subject = issue.fields.summary
    create.description = issue.fields.description
  }
  issue.fields.comment.comments.forEach((c) => {
    create.notes.push(j2rFormatComment(c))
  })
  // await Promise.all(uploads)
  return create
}

const j2rUpdateIssue = async ({issue, user, changelog}) => {
  // TODO: stream attachments
  let key, update, delivered
  if (changelog && user.emailAddress !== config.botAddress) {
    key = j2rGetRedmineIssue(issue)
    // const attachments = changelog.items
    //  .filter(i => i.field === 'Attachment')
    //  .map(a => issue.fields.attachment.find(ia => ia.id === a.to))
    // const uploads = attachments.map(a => j2rAttachment(a).then(r => update.uploads.push(r)))
    update = {
      status_id: config.JiraMapStatus[issue.fields.status.id],
      custom_fields: [],
      uploads: []
    }
    const type = j2rGetJiraType(issue)
    if (type === config.JiraGenerique) {
      update.project_id = config.RedmineSupportDev
    } else if (type === config.JiraSpecifique) {
      update.project_id = j2rGetRedmineProject(issue)
      update.custom_fields.push({id: 21, value: 50}) // TODO: hard coded?
    }
    // await Promise.all(uploads)
    if (!update.custom_fields.length) {
      delete update['custom_fields']
    }
    if (issue.fields.status.id === config.JiraDelivered) {
      delivered = {
        fields: {
          [`custom_field_${config.JiraDeliveredField}`]: moment().format('YYYY-MM-DD')
        }
      }
    }
  }
  return {key, update, delivered}
}

const j2rComment = async ({issue, user, comment}) => {
  // TODO: stream attachments
  let key, update
  if (!comment.body.match(/^\*Message transféré de /)) {
    comment.body.replace(/!\w+\.\w+\|thumbnail!/, '')
    if (comment.body !== '') {
      key = j2rGetRedmineIssue(issue)
      update = {
        notes: j2rFormatComment(comment)
      }
    }
  }
  return {key, update}
}

const r2jGetJiraIssue = (issue) => {
  const field = issue.custom_fields.find((f) => f.id === config.RedmineJiraRef)
  return field && field.value
}

const r2jFormatComment = (journal) => {
  return `*Message transféré de ${journal.author.firstname} ${journal.author.lastname}* : ${journal.notes}`
}

// Change custom_field_10056 => Bug Type (Specific or Generic)
const r2j = ({action, issue, journal}) => {
  let act, data
  const key = r2jGetJiraIssue(issue)
  if (action === 'updated') {
    if (parseInt(journal.author.id) !== config.RedmineBotId) {
      if (journal.details.length === 0) {
        if (journal.private_notes) return {act, key, data}
        act = 'comment'
        data = {body: r2jFormatComment(journal)}
        return {act, key, data}
      }
      act = 'update'
      data = {fields: {}}
      journal.details.forEach((detail) => {
        // TODO: update title / desc?
        if (detail.prop_key === 'status_id') {
          data.transition = {id: config.RedmineMapStatus[detail.value]}
        } else if (detail.prop_key === 'project_id') {
          data.fields[`customfield_${config.JiraBugType}`] = {id: config.RedmineMapProject[detail.value]}
        }
      })
      if (data.transition) {
        act = 'transition'
      }
    } else {
      act = 'nothing'
    }
  } else {
    act = action
  }
  return {act, key, data}
}

module.exports = {
  // j2rAttachment,
  j2rCreateIssue,
  j2rUpdateIssue,
  j2rComment,
  r2j
}
