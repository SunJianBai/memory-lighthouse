package com.sun.minicpmo_android.lighthouse.model

fun taskResolutionLabel(code: String?): String = when (code) {
    "FAMILY_CONFIRMED" -> "家属已确认处理"
    "NOT_ACTIONABLE" -> "无需继续处理"
    "FAMILY_VERIFIED_COMPLETE" -> "家属核验为完成"
    "FAMILY_VERIFIED_NOT_COMPLETE" -> "家属核验为未完成"
    null, "" -> "未记录具体结果"
    else -> "已记录处理结果"
}

enum class FamilyTaskFilter(val label: String, val emptyLabel: String) {
    UNFINISHED("全部未完成", "暂无未完成待办"),
    UNCLAIMED("待认领", "暂无待认领事项"),
    MINE("我负责", "暂无由你负责的未完成事项"),
    ENDED("已结束", "暂无已结束事项");

    fun select(tasks: List<FamilyTaskView>) = tasks.filter { task ->
        val unfinished = task.status in setOf("OPEN", "CLAIMED")
        when (this) {
            UNFINISHED -> unfinished
            UNCLAIMED -> task.status == "OPEN" && task.assigneeMemberId == null
            MINE -> unfinished && task.assignedToMe
            ENDED -> task.status in setOf("RESOLVED", "DISMISSED")
        }
    }
}
